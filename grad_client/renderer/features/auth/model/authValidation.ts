export const EMAIL_MAX_LENGTH = 100
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 64

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PASSWORD_SPECIAL_PATTERN = /[@$!%*#?&~^_\-+=[\]{}|:;.,<>/?]/

export function normalizeEmailInput(email: string) {
  return email.trim().toLowerCase()
}

export function getEmailValidationError(email: string) {
  const trimmed = email.trim()

  if (!trimmed) {
    return '이메일 주소를 입력해 주세요.'
  }

  if (trimmed.length > EMAIL_MAX_LENGTH) {
    return '이메일 주소는 최대 100자까지 입력할 수 있습니다.'
  }

  if (!EMAIL_PATTERN.test(trimmed)) {
    return '올바른 이메일 형식을 입력해 주세요. (예: user@example.com)'
  }

  return null
}

export function getPasswordValidationError(password: string) {
  if (!password) {
    return '비밀번호를 입력해 주세요.'
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return '비밀번호는 최소 8자 이상이어야 합니다.'
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return '비밀번호는 최대 64자까지 입력할 수 있습니다.'
  }

  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password) || !PASSWORD_SPECIAL_PATTERN.test(password)) {
    return '비밀번호는 영문, 숫자, 특수문자를 모두 포함해야 합니다.'
  }

  return null
}
