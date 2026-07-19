# Email Setup

Published report PDFs are always generated. Emails are sent only when SMTP settings are configured.

## Setup

1. Copy `email-settings.env.example`.
2. Rename the copy to `email-settings.env`.
3. Fill in your SMTP values.
4. Restart the Node server.
5. Open Admin Portal > Publish Results. The page should show "Email is configured".

## Example For Gmail

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

For Gmail, `SMTP_PASS` should be an app password, not your normal account password.

## Example For A Custom Domain

```env
SMTP_HOST=mail.yourdomain.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=results@yourdomain.com
SMTP_PASS=your-mailbox-password
SMTP_FROM=results@yourdomain.com
```

Use port `465` with `SMTP_SECURE=true` for this app. The server does not currently upgrade plain port `587` connections with STARTTLS.
