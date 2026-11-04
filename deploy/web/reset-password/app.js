(() => {
  const TOKEN_PATTERN = /^[0-9a-fA-F]{64}$/
  const SPECIAL_PATTERN = /[@$!%*#?&~^_\-+=[\]{}|:;.,<>/?]/

  const invalidView = document.getElementById('invalid-view')
  const formView = document.getElementById('form-view')
  const successView = document.getElementById('success-view')
  const form = document.getElementById('reset-form')
  const newPassword = document.getElementById('new-password')
  const confirmPassword = document.getElementById('confirm-password')
  const togglePassword = document.getElementById('toggle-password')
  const feedback = document.getElementById('feedback')
  const submitButton = document.getElementById('submit-button')

  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const token = (hash.get('token') || '').trim()

  // The fragment is never sent to the server. Remove it from the address bar immediately.
  window.history.replaceState(null, '', window.location.pathname)

  if (!TOKEN_PATTERN.test(token)) {
    formView.hidden = true
    successView.hidden = true
    invalidView.hidden = false
    return
  }

  invalidView.hidden = true
  successView.hidden = true
  formView.hidden = false
  newPassword.focus()

  togglePassword.addEventListener('click', () => {
    const showing = newPassword.type === 'text'
    newPassword.type = showing ? 'password' : 'text'
    confirmPassword.type = showing ? 'password' : 'text'
    togglePassword.textContent = showing ? '보기' : '숨기기'
    togglePassword.setAttribute('aria-pressed', String(!showing))
    togglePassword.setAttribute('aria-label', showing ? '비밀번호 보기' : '비밀번호 숨기기')
  })

  function showError(message) {
    feedback.textContent = message
    feedback.hidden = false
  }

  function getPasswordError(password) {
    if (!password) return '새 비밀번호를 입력해 주세요.'
    if (password.length < 8) return '비밀번호는 최소 8자 이상이어야 합니다.'
    if (password.length > 64) return '비밀번호는 최대 64자까지 입력할 수 있습니다.'
    if (!/[a-zA-Z]/.test(password) || !/\d/.test(password) || !SPECIAL_PATTERN.test(password)) {
      return '비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.'
    }
    return null
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    feedback.hidden = true

    const passwordError = getPasswordError(newPassword.value)
    if (passwordError) {
      showError(passwordError)
      newPassword.focus()
      return
    }

    if (newPassword.value !== confirmPassword.value) {
      showError('새 비밀번호와 확인 값이 일치하지 않습니다.')
      confirmPassword.focus()
      return
    }

    submitButton.disabled = true
    submitButton.textContent = '변경 중...'

    try {
      const response = await fetch('/api/users/password-reset/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ token, new_password: newPassword.value }),
        credentials: 'omit',
        cache: 'no-store',
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || payload.status !== 'success') {
        throw new Error(payload && payload.message ? payload.message : '비밀번호를 변경하지 못했습니다.')
      }

      form.reset()
      formView.hidden = true
      successView.hidden = false
    } catch (error) {
      showError(error instanceof Error ? error.message : '비밀번호를 변경하지 못했습니다.')
    } finally {
      submitButton.disabled = false
      submitButton.textContent = '비밀번호 변경'
    }
  })
})()
