// ResumeAI Pro — email validation utility
// Blocks disposable domains, example domains, and obviously fake emails.

// Common disposable/temporary email domains
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "tempmail.com", "tempmail.org",
  "10minutemail.com", "throwaway.email", "trashmail.com", "yopmail.com",
  "getnada.com", "maildrop.cc", "dispostable.com", "fakeinbox.com",
  "sharklasers.com", "guerrillamailblock.com", "spam4.me", "mailcatch.com",
  "tempinbox.com", "mohmal.com", "emailondeck.com", "tempmailo.com",
]);

/**
 * Validate that an email is a "real" email — not @example.*, not a known
 * disposable domain, and matches a proper email format.
 * Returns { valid: boolean, error?: string }.
 */
export function validateRealEmail(email: string): { valid: boolean; error?: string } {
  const trimmed = email.trim().toLowerCase();

  if (!trimmed) {
    return { valid: false, error: "Email is required." };
  }

  // Basic RFC-like email format check
  const emailRegex = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  if (!emailRegex.test(trimmed)) {
    return { valid: false, error: "Please enter a valid email address." };
  }

  const domain = trimmed.split("@")[1];

  // Block example.* domains (RFC 2606 reserved)
  if (domain.endsWith(".example") || domain === "example.com" || domain === "example.org" || domain === "example.net" || domain.endsWith(".example.com") || domain.endsWith(".example.org")) {
    return { valid: false, error: "Please use a real email address — @example.* domains are not allowed." };
  }

  // Block test.* domains (RFC 2606 reserved)
  if (domain.endsWith(".test") || domain.endsWith(".invalid") || domain.endsWith(".localhost")) {
    return { valid: false, error: "Please use a real email address — test/invalid domains are not allowed." };
  }

  // Block disposable email services
  if (DISPOSABLE_DOMAINS.has(domain)) {
    return { valid: false, error: "Please use a real email address — disposable email services are not allowed." };
  }

  // Block obvious placeholder emails used in testing
  if (trimmed.startsWith("test@") || trimmed.startsWith("demo@") || trimmed.startsWith("user@") || trimmed.startsWith("fake@")) {
    // Allow if the domain is a real provider (gmail, outlook, yahoo, etc.)
    const realProviders = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.fr", "yahoo.co.uk", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com", "tutanota.com", "gmx.com", "gmx.net", "web.de", "aol.com", "zoho.com", "mail.com", "yandex.com", "yandex.ru"];
    if (!realProviders.includes(domain)) {
      return { valid: false, error: "Please use a real email address from a legitimate email provider." };
    }
  }

  return { valid: true };
}

/**
 * List of common real email providers for display hints.
 */
export const REAL_EMAIL_PROVIDERS = [
  "gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com",
  "proton.me", "protonmail.com", "tutanota.com", "live.com", "aol.com",
];
