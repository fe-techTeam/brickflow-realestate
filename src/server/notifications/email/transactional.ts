import { z } from "zod";
import type { EmailContent } from "../templates";

/**
 * Account emails that bypass notification preferences (a user cannot opt out of a password reset)
 * and carry no unsubscribe link. Fields listed in `sensitive` are redacted from the delivery log
 * once the send has finished, successfully or not.
 */
interface TransactionalTemplate<S extends z.ZodType> {
  schema: S;
  sensitive: (keyof z.infer<S>)[];
  reason: string;
  render: (data: z.infer<S>) => { content: EmailContent; ctaUrl?: string };
}

function define<S extends z.ZodType>(template: TransactionalTemplate<S>) {
  return template;
}

export const TRANSACTIONAL_TEMPLATES = {
  "password-reset": define({
    schema: z.object({
      name: z.string().trim().max(120).optional(),
      resetUrl: z.url({ protocol: /^https?$/ }),
      expiresInMinutes: z.number().int().min(1).max(24 * 60),
    }),
    sensitive: ["resetUrl"],
    reason: "You are receiving this email because a password reset was requested for your BrickFlow account. If it was not you, ignore this email; your password stays unchanged.",
    render: (d) => ({
      content: {
        subject: "Reset your BrickFlow password",
        heading: "Reset your password",
        intro: `Use the button below to choose a new password. The link works once and expires in ${d.expiresInMinutes} minutes.`,
        facts: [],
        cta: { label: "Choose a new password", path: d.resetUrl },
      },
      ctaUrl: d.resetUrl,
    }),
  }),
} as const;

export type TransactionalTemplateName = keyof typeof TRANSACTIONAL_TEMPLATES;

export type TransactionalTemplateData<T extends TransactionalTemplateName> = z.input<(typeof TRANSACTIONAL_TEMPLATES)[T]["schema"]>;

export function isTransactionalTemplate(name: string): name is TransactionalTemplateName {
  return Object.hasOwn(TRANSACTIONAL_TEMPLATES, name);
}

/** Links in account emails must point at this deployment, never at a host taken from user input. */
export function assertSameOrigin(url: string, appUrl: string): void {
  if (new URL(url).origin !== new URL(appUrl).origin) throw new Error("Email links must use the APP_URL origin");
}
