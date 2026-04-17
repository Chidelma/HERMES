import { test, expect } from 'bun:test'
import { request, dockerRun, IMAGE } from './helpers.mjs'

test('running container responds on the health endpoint', async () => {
  const res = await request('/')
  expect(res.status).toBeGreaterThanOrEqual(200)
  expect(res.status).toBeLessThan(500)
})

test('entrypoint prints help and exits 0', () => {
  const { status, stdout } = dockerRun([IMAGE, 'help'])
  expect(status).toBe(0)
  expect(stdout).toContain('Hermes container commands')
  expect(stdout).toContain('serve')
  expect(stdout).toContain('admin:create')
})

test('entrypoint rejects unsupported command', () => {
  const { status, stderr } = dockerRun([IMAGE, 'shell'])
  expect(status).toBe(64)
  expect(stderr).toContain('Unsupported Hermes container command')
})
