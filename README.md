# minichat

Минималистичный веб‑мессенджер (одна общая комната) под Ubuntu 24.04.

- Без регистрации/логина
- Ник назначается автоматически и хранится в `localStorage`
- Реальное время через WebSocket (socket.io)
- Хранение последних `N` сообщений в памяти (по умолчанию 200)
- Mobile-first UI: чат на весь экран, поле ввода закреплено снизу
- Чёрно‑белый консольный стиль, **без скруглений** (`border-radius: 0`)
- Защита от XSS: вывод через `textContent` (не `innerHTML`)

## Структура проекта

```text
minichat/
  server.js
  package.json
  scripts/
    copy-fonts.js
  public/
    index.html
    style.css
    app.js
    assets/
      font/
        jetbrains-mono/
          400.css
          700.css
          files/...
  systemd/
    minichat.service
