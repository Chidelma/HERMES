// ── Config ────────────────────────────────────────────────────────────────
const API_URL = (window.HERMES_CONFIG && window.HERMES_CONFIG.apiUrl) || ''

// ── Auth state ────────────────────────────────────────────────────────────
const auth = {
  get token() { return sessionStorage.getItem('hermes_token') },
  get email() { return sessionStorage.getItem('hermes_email') },
  get role()  { return sessionStorage.getItem('hermes_role') },
  get domains() {
    try { return JSON.parse(sessionStorage.getItem('hermes_domains') || '[]') }
    catch { return [] }
  },
  save(data) {
    sessionStorage.setItem('hermes_token', data.token)
    sessionStorage.setItem('hermes_email', data.email)
    sessionStorage.setItem('hermes_role', data.role)
    sessionStorage.setItem('hermes_domains', JSON.stringify(data.domains))
  },
  clear() {
    sessionStorage.removeItem('hermes_token')
    sessionStorage.removeItem('hermes_email')
    sessionStorage.removeItem('hermes_role')
    sessionStorage.removeItem('hermes_domains')
  },
  get isLoggedIn() { return !!this.token },
}

// ── API client ────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (auth.token) headers['Authorization'] = `Bearer ${auth.token}`

  const res = await fetch(API_URL + path, { ...options, headers })

  if (res.status === 401) {
    auth.clear()
    showLogin()
    return null
  }

  return res
}

// ── Router ────────────────────────────────────────────────────────────────
const views = ['inbox', 'email', 'compose', 'settings']

function navigate(view, pushState = true) {
  for (const v of views) {
    const el = document.getElementById(`view-${v}`)
    if (el) el.hidden = v !== view
  }

  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view)
  })

  if (pushState) {
    const paths = { inbox: '/inbox', compose: '/compose', settings: '/settings', email: '/inbox' }
    history.pushState({ view }, '', paths[view] || '/inbox')
  }

  if (view === 'inbox') loadInbox()
  if (view === 'settings') loadSettings()
}

// ── Screen helpers ────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('screen-login').hidden = false
  document.getElementById('screen-app').hidden = true
}

function showApp() {
  document.getElementById('screen-login').hidden = true
  document.getElementById('screen-app').hidden = false
  document.getElementById('app-user-email').textContent = auth.email || ''
}

// ── Toast ─────────────────────────────────────────────────────────────────
let _toastTimer
function toast(msg, duration = 2500) {
  clearTimeout(_toastTimer)
  let el = document.getElementById('hermes-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'hermes-toast'
    el.className = 'toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.display = 'block'
  _toastTimer = setTimeout(() => { el.style.display = 'none' }, duration)
}

// ── Login flow ────────────────────────────────────────────────────────────
let _sessionId = ''

function initLogin() {
  const step1 = document.getElementById('login-step-1')
  const step2 = document.getElementById('login-step-2')
  const err1 = document.getElementById('login-error-1')
  const err2 = document.getElementById('login-error-2')

  document.getElementById('btn-request-otp').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim()
    const phone = document.getElementById('login-phone').value.trim()
    err1.style.display = 'none'

    if (!email || !phone) {
      err1.textContent = 'Email and phone are required.'
      err1.style.display = 'block'
      return
    }

    const btn = document.getElementById('btn-request-otp')
    btn.disabled = true
    btn.textContent = 'Sending…'

    try {
      const res = await fetch(API_URL + '/auth/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, phone }),
      })
      const data = await res.json()

      if (!res.ok) {
        err1.textContent = data.error || 'Unable to send code. Please try again.'
        err1.style.display = 'block'
        return
      }

      _sessionId = data.sessionId
      step1.hidden = true
      step2.hidden = false
      document.getElementById('login-otp').focus()
    } catch {
      err1.textContent = 'Network error. Check your connection.'
      err1.style.display = 'block'
    } finally {
      btn.disabled = false
      btn.textContent = 'Send code'
    }
  })

  document.getElementById('btn-confirm-otp').addEventListener('click', async () => {
    const code = document.getElementById('login-otp').value.trim()
    err2.style.display = 'none'

    if (!code || code.length !== 6) {
      err2.textContent = 'Enter the 6-digit code.'
      err2.style.display = 'block'
      return
    }

    const btn = document.getElementById('btn-confirm-otp')
    btn.disabled = true
    btn.textContent = 'Verifying…'

    try {
      const res = await fetch(API_URL + '/auth/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: _sessionId, code }),
      })
      const data = await res.json()

      if (!res.ok) {
        err2.textContent = data.error || 'Invalid code. Please try again.'
        err2.style.display = 'block'
        return
      }

      auth.save(data)
      showApp()
      navigate('inbox', false)
      history.replaceState({ view: 'inbox' }, '', '/inbox')
    } catch {
      err2.textContent = 'Network error. Check your connection.'
      err2.style.display = 'block'
    } finally {
      btn.disabled = false
      btn.textContent = 'Verify'
    }
  })

  document.getElementById('btn-back-to-step1').addEventListener('click', () => {
    step2.hidden = true
    step1.hidden = false
    err2.style.display = 'none'
  })

  // Allow Enter key to submit
  document.getElementById('login-email').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('login-phone').focus()
  })
  document.getElementById('login-phone').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-request-otp').click()
  })
  document.getElementById('login-otp').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirm-otp').click()
  })
}

// ── Inbox ─────────────────────────────────────────────────────────────────
let _emails = []

function formatDate(iso) {
  const d = new Date(iso)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function initials(address) {
  const name = address.split('@')[0] || '?'
  return name.slice(0, 2).toUpperCase()
}

async function loadInbox() {
  const list = document.getElementById('inbox-list')
  list.innerHTML = '<div class="inbox-empty" id="inbox-loading"><div class="spinner"></div><span>Loading…</span></div>'

  const res = await apiFetch('/inbox')
  if (!res) return

  const emails = await res.json()
  _emails = Array.isArray(emails) ? emails : []

  if (_emails.length === 0) {
    list.innerHTML = `
      <div class="inbox-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 12h-6l-2 3h-4l-2-3H2"/>
          <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
        </svg>
        <span>No messages</span>
      </div>`
    return
  }

  list.innerHTML = _emails.map(email => `
    <div class="email-row unread" data-id="${email.id}">
      <div class="email-avatar">${initials(email.sender)}</div>
      <div class="email-meta">
        <div class="email-sender">${escHtml(email.sender)}</div>
        <div class="email-subject">${escHtml(email.subject)}</div>
      </div>
      <span class="email-time">${formatDate(email.receivedAt)}</span>
    </div>
  `).join('')

  list.querySelectorAll('.email-row').forEach(row => {
    row.addEventListener('click', () => openEmail(row.dataset.id))
  })
}

function openEmail(id) {
  const email = _emails.find(e => e.id === id)
  if (!email) return

  document.getElementById('detail-subject').textContent = email.subject
  document.getElementById('detail-from').textContent = email.sender
  document.getElementById('detail-to').textContent = `To: ${email.recipient}`
  document.getElementById('detail-date').textContent = new Date(email.receivedAt).toLocaleString()
  document.getElementById('detail-avatar').textContent = initials(email.sender)
  document.getElementById('detail-body').textContent = email.rawKey || '(No body)'

  document.getElementById('btn-delete-email').dataset.id = id
  document.getElementById('btn-reply').dataset.to = email.sender
  document.getElementById('btn-reply').dataset.subject = `Re: ${email.subject}`

  navigate('email')
}

// ── Compose ───────────────────────────────────────────────────────────────
function initCompose() {
  document.getElementById('btn-discard').addEventListener('click', () => navigate('inbox'))

  document.getElementById('btn-send').addEventListener('click', async () => {
    const from = document.getElementById('compose-from').value.trim()
    const to = document.getElementById('compose-to').value.trim()
    const cc = document.getElementById('compose-cc').value.trim()
    const subject = document.getElementById('compose-subject').value.trim()
    const text = document.getElementById('compose-body').value.trim()

    if (!from || !to || !subject) {
      toast('From, To, and Subject are required.')
      return
    }

    const btn = document.getElementById('btn-send')
    btn.disabled = true
    btn.textContent = 'Sending…'

    try {
      const res = await apiFetch('/send', {
        method: 'POST',
        body: JSON.stringify({ from, to: [to], cc: cc ? [cc] : [], subject, text }),
      })
      if (!res) return
      if (res.ok) {
        toast('Message sent.')
        clearCompose()
        navigate('inbox')
      } else {
        const data = await res.json()
        toast(data.error || 'Send failed.')
      }
    } catch {
      toast('Network error.')
    } finally {
      btn.disabled = false
      btn.textContent = 'Send'
    }
  })
}

function clearCompose() {
  for (const id of ['compose-from', 'compose-to', 'compose-cc', 'compose-subject', 'compose-body']) {
    const el = document.getElementById(id)
    if (el) el.value = ''
  }
}

function openCompose(prefill = {}) {
  if (prefill.from) document.getElementById('compose-from').value = prefill.from
  if (prefill.to) document.getElementById('compose-to').value = prefill.to
  if (prefill.subject) document.getElementById('compose-subject').value = prefill.subject
  navigate('compose')
}

// ── Settings ──────────────────────────────────────────────────────────────
async function loadSettings() {
  const container = document.getElementById('settings-routes-container')
  container.innerHTML = '<div class="inbox-empty"><div class="spinner"></div><span>Loading…</span></div>'

  const res = await apiFetch('/domains')
  if (!res) return

  const domains = await res.json()

  if (!Array.isArray(domains) || domains.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);padding:1rem;">No domains configured.</p>'
    return
  }

  container.innerHTML = domains.map(domain => `
    <div style="margin-bottom:1rem;">
      <p style="font-size:13px;font-weight:600;margin:0 0 0.5rem;color:var(--muted);">${escHtml(domain.domain)}</p>
      <div class="settings-card">
        ${(domain.routes || []).map(route => `
          <div class="settings-row">
            <span class="settings-row-label">${escHtml(route.match)}</span>
            <span class="route-badge ${route.action.type}">${route.action.type}</span>
            <span style="color:var(--muted);font-size:12px;margin-left:0.5rem;">${route.enabled ? '' : '(disabled)'}</span>
          </div>
        `).join('') || '<div class="settings-row"><span style="color:var(--muted);">No rules</span></div>'}
      </div>
    </div>
  `).join('')

  if (auth.role === 'admin') {
    document.getElementById('settings-users-section').hidden = false
    loadUsers()
  }
}

async function loadUsers() {
  const container = document.getElementById('settings-users-container')
  const res = await apiFetch('/users')
  if (!res) return
  const users = await res.json()

  if (!Array.isArray(users) || users.length === 0) {
    container.innerHTML = '<p style="color:var(--muted);font-size:13px;">No users.</p>'
    return
  }

  container.innerHTML = `
    <div class="settings-card">
      ${users.map(u => `
        <div class="settings-row">
          <span class="settings-row-label">${escHtml(u.email)}</span>
          <span class="settings-row-value">${u.domains.join(', ')}</span>
          <span class="route-badge ${u.role === 'admin' ? 'store' : 'forward'}" style="margin-left:0.5rem;">${u.role}</span>
        </div>
      `).join('')}
    </div>`
}

// ── Utility ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initLogin()
  initCompose()

  // Nav clicks
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => navigate(btn.dataset.view))
  })

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    auth.clear()
    showLogin()
    history.replaceState({}, '', '/')
  })

  // Email detail actions
  document.getElementById('btn-back-inbox').addEventListener('click', () => navigate('inbox'))
  document.getElementById('btn-delete-email').addEventListener('click', async function () {
    const id = this.dataset.id
    if (!id) return
    if (!confirm('Delete this message?')) return
    const res = await apiFetch(`/inbox/${id}`, { method: 'DELETE' })
    if (res && res.ok) {
      _emails = _emails.filter(e => e.id !== id)
      toast('Message deleted.')
      navigate('inbox')
    } else {
      toast('Delete failed.')
    }
  })

  document.getElementById('btn-reply').addEventListener('click', function () {
    openCompose({
      from: auth.domains.length ? `me@${auth.domains[0]}` : '',
      to: this.dataset.to,
      subject: this.dataset.subject,
    })
  })

  document.getElementById('btn-refresh-inbox').addEventListener('click', loadInbox)

  // Keyboard shortcut: C to compose
  document.addEventListener('keydown', e => {
    if (e.key === 'c' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) {
      openCompose({ from: auth.domains.length ? `me@${auth.domains[0]}` : '' })
    }
  })

  // Browser back/forward
  window.addEventListener('popstate', e => {
    if (auth.isLoggedIn) {
      const view = (e.state && e.state.view) || 'inbox'
      navigate(view, false)
    }
  })

  // Initial render
  if (auth.isLoggedIn) {
    showApp()
    const pathView = { '/inbox': 'inbox', '/compose': 'compose', '/settings': 'settings' }
    const view = pathView[location.pathname] || 'inbox'
    navigate(view, false)
  } else {
    showLogin()
  }
})
