import type { ThemeMode } from '../../../design-system/theme/ThemeContext'
import loginBeigeUrl from '../assets/themes/login-beige.webp'
import loginDarkUrl from '../assets/themes/login-dark.webp'
import loginNavyUrl from '../assets/themes/login-navy.webp'
import loginWhiteUrl from '../assets/themes/login-white.webp'
import signupBeigeUrl from '../assets/themes/signup-beige.webp'
import signupDarkUrl from '../assets/themes/signup-dark.webp'
import signupNavyUrl from '../assets/themes/signup-navy.webp'
import signupWhiteUrl from '../assets/themes/signup-white.webp'

export type AuthIllustrationVariant = 'login' | 'signup'

const AUTH_ILLUSTRATION_URLS: Record<
  AuthIllustrationVariant,
  Record<ThemeMode, string>
> = {
  login: {
    white: loginWhiteUrl,
    beige: loginBeigeUrl,
    dark: loginDarkUrl,
    navy: loginNavyUrl,
  },
  signup: {
    white: signupWhiteUrl,
    beige: signupBeigeUrl,
    dark: signupDarkUrl,
    navy: signupNavyUrl,
  },
}

export function getAuthIllustrationUrl(
  variant: AuthIllustrationVariant,
  themeMode: ThemeMode,
): string {
  return AUTH_ILLUSTRATION_URLS[variant][themeMode]
}
