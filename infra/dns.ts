import * as aws from '@pulumi/aws'
import * as pulumi from '@pulumi/pulumi'
import { domainDkims, domainVerificationTokens } from './ses'
import { domainAssociations } from './amplify'

const cfg = new pulumi.Config()
const domains = cfg.requireObject<string[]>('domains')
const awsCfg = new pulumi.Config('aws')
const region = awsCfg.require('region')

/** Looks up the hosted zone for each domain and adds required DNS records. */
export const dnsResources = domains.flatMap((domain, i) => {
  const zone = aws.route53.getZoneOutput({ name: domain })
  const dkim = domainDkims[i]

  // SES domain verification TXT record
  const verificationRecord = new aws.route53.Record(`hermes-ses-verify-${domain}`, {
    zoneId: zone.zoneId,
    name: `_amazonses.${domain}`,
    type: 'TXT',
    ttl: 300,
    records: [pulumi.interpolate`${domainVerificationTokens[i]}`],
  })

  // DKIM CNAME records (SES issues 3 tokens)
  const dkimRecords = [0, 1, 2].map(
    j =>
      new aws.route53.Record(`hermes-dkim-${domain}-${j}`, {
        zoneId: zone.zoneId,
        name: dkim.dkimTokens[j].apply(t => `${t}._domainkey.${domain}`),
        type: 'CNAME',
        ttl: 300,
        records: [dkim.dkimTokens[j].apply(t => `${t}.dkim.amazonses.com`)],
      })
  )

  // MX record pointing inbound mail to SES
  const mxRecord = new aws.route53.Record(`hermes-mx-${domain}`, {
    zoneId: zone.zoneId,
    name: domain,
    type: 'MX',
    ttl: 300,
    records: [`10 inbound-smtp.${region}.amazonaws.com`],
  })

  // SPF TXT record
  const spfRecord = new aws.route53.Record(`hermes-spf-${domain}`, {
    zoneId: zone.zoneId,
    name: domain,
    type: 'TXT',
    ttl: 300,
    records: ['v=spf1 include:amazonses.com ~all'],
  })

  // DMARC TXT record
  const dmarcRecord = new aws.route53.Record(`hermes-dmarc-${domain}`, {
    zoneId: zone.zoneId,
    name: `_dmarc.${domain}`,
    type: 'TXT',
    ttl: 300,
    records: [`v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`],
  })

  // Amplify custom domain: mail.<domain> CNAME + ACM cert validation CNAME
  const assoc = domainAssociations[i]

  // ACM certificate validation record (format: "<name>. CNAME <value>.")
  const certRecord = new aws.route53.Record(`hermes-amplify-cert-${domain}`, {
    zoneId: zone.zoneId,
    name: assoc.certificateVerificationDnsRecord.apply(r => r.split(' CNAME ')[0].replace(/\.$/, '')),
    type: 'CNAME',
    ttl: 300,
    records: [assoc.certificateVerificationDnsRecord.apply(r => r.split(' CNAME ')[1].replace(/\.$/, ''))],
  })

  // mail.<domain> CNAME to Amplify (subDomain dnsRecord format: "mail CNAME <target>")
  const mailRecord = new aws.route53.Record(`hermes-mail-cname-${domain}`, {
    zoneId: zone.zoneId,
    name: `mail.${domain}`,
    type: 'CNAME',
    ttl: 300,
    records: [assoc.subDomains[0].dnsRecord.apply(r => r.split(' CNAME ')[1].replace(/\.$/, ''))],
  })

  return [verificationRecord, ...dkimRecords, mxRecord, spfRecord, dmarcRecord, certRecord, mailRecord]
})
