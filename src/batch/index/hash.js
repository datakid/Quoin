const hex = (digest) => Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Text(text) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export async function sha256Bytes(bytes) {
  return hex(await crypto.subtle.digest('SHA-256', bytes));
}
