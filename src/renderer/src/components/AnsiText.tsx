import { useMemo } from 'react'
import Anser from 'anser'
import { theme } from 'antd'

export function AnsiText({ text }: { text: string }): React.ReactElement {
  const { token } = theme.useToken()
  const entries = useMemo(() => {
    const tokens = Anser.ansiToJson(text, { use_classes: false })
    return tokens
      .filter((item) => Boolean(item.content))
      .map((item, index) => ({
        key: index,
        content: item.content,
        color: item.fg ? 'rgb(' + item.fg + ')' : item.fg_truecolor ?? token.colorText,
        bold: item.decoration === 'bold' || item.decorations?.includes('bold') === true
      }))
  }, [text, token])

  return (
    <>
      {entries.map((entry) => (
        <span key={entry.key} style={{ color: entry.color, fontWeight: entry.bold ? 600 : 400 }}>
          {entry.content}
        </span>
      ))}
    </>
  )
}
