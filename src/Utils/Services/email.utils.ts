import nodemailer from 'nodemailer'
import { IEmailArgument } from '../../Common'

export const sendEmail = async ({ to, cc, subject, content, attachments = [] }: IEmailArgument) => {
  const port = Number(process.env.SMTP_PORT)
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465, // 465 = implicit TLS, 587 = STARTTLS
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  const info = await transporter.sendMail({
    from: `"NO-REPLY" <${process.env.USER_EMAIL}>`,
    to,
    cc,
    subject,
    html: content,
    attachments,
  })
  return info
}

import { EventEmitter } from 'node:events'
export const localEventEmitter = new EventEmitter()

localEventEmitter.on('sendEmail', async (args: IEmailArgument) => {
  try {
    await sendEmail(args)
  } catch (error) {
    console.error('email sending failed:', error)
  }
})
