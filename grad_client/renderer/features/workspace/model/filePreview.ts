/**
 * 파일 미리보기 지원 판별 유틸.
 * 텍스트로 읽을 수 있는 형식만 미리보기 모달에서 렌더링하고, 그 외에는 안내 문구만 노출한다.
 */
export const PREVIEWABLE_FILE_EXTENSIONS: readonly string[] = [
  // 문서
  'md',
  'markdown',
  'txt',
  'log',
  'csv',
  'tsv',
  // 데이터 · 설정
  'json',
  'xml',
  'yml',
  'yaml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'env',
  'properties',
  'sql',
  // 코드
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'less',
  'html',
  'htm',
  'vue',
  'svelte',
  'py',
  'java',
  'kt',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'swift',
  'sh',
  'bat',
  'ps1',
]

export function getFileExtension(fileName: string): string {
  const trimmed = (fileName ?? '').trim()
  const dotIndex = trimmed.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) return ''
  return trimmed.slice(dotIndex + 1).toLowerCase()
}

export function isPreviewableFile(fileName: string): boolean {
  const extension = getFileExtension(fileName)
  return extension !== '' && PREVIEWABLE_FILE_EXTENSIONS.includes(extension)
}
