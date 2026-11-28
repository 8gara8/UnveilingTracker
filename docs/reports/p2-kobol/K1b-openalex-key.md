# K1b first item: the OpenAlex key helper and how JL gets a key

Checked on Kobol on 2026-11-28, about 13:15 Taipei (05:15 UTC). This file holds no key value, and no
keychain item was created or read.

## (a) The helper, `/Users/kobol/.unveiling/store-token.zsh`

The helper lives outside the repo, has mode 700, and passes `zsh -n`. I read it against SPEC 9.6 and did
not run it.

Its `--openalex` path already did everything SPEC 9.6 describes:

- It reads the value from the clipboard (`pbpaste`) and drops all whitespace.
- It refuses an empty value (`E_EMPTY`), and refuses a value that cannot be a key with `E_NOT_A_KEY`.
  That code comes from `E_NOT_A_${kind:u}` with `kind=key`.
- It stores the value under the service `unveiling-openalex-key` in the login keychain, replacing an
  older one (`-U`). `security -i` reads `add-generic-password ...` on standard input, so the value is in
  no process's arguments, and that command's output goes nowhere.
- It reads the value back with `find-generic-password -w` and compares it (`E_STORE` on a mismatch),
  then clears the clipboard.
- It tests the key with one OpenAlex request. `curl` gets its URL, with `api_key=`, in a config read on
  standard input (`-K -`), so the key is not on the command line. The test runs only after the key is
  stored and read back, and never on any other path.
- It prints `ok` or an error code, never the value.

I changed two things, both inside the helper:

1. **The minimum length for a key is now 8 characters, not 20.** OpenAlex documents no key format or
   length, so the 20-character floor meant for Claude tokens could have refused a real key with
   `E_NOT_A_KEY`. Tokens keep the 20-character floor.
2. **`E_SMOKE` now carries OpenAlex's own reason.** SPEC 9.6 asks Claude to "read OpenAlex's answer in
   the reason". Before, the helper printed only the HTTP code. Now, on any answer other than 200, it
   takes the `error`, `code` or `reason` field of OpenAlex's JSON answer, up to 80 characters, with the
   key replaced by `[key]` should it appear, and prints it in brackets. For example:
   `E_SMOKE: OpenAlex answered HTTP 403 with the stored key (key_not_activated).` I checked the parsing
   on an invented answer, with no request and no keychain call.

   The test request also asks for `select=id` now, so its answer is small. It still costs 1 credit.

After the edit `zsh -n` passes and the mode is still 700.

## (b) How JL gets a free OpenAlex key

From OpenAlex's own page on keys, https://help.openalex.org/api/authentication/ (fetched today, 200):

1. Make an account at https://openalex.org/signup. The page says it takes "about 30 seconds". The
   sign-up page itself refuses scripts (it answered 403 to my plain GET), so I could not see whether it
   offers Google or ORCID sign-in as well as email.
2. The key works only once its email address is verified: "there are just two states: no key, or a key
   with a verified email".
3. Copy the key from **Settings → API key**, https://openalex.org/settings/api-key: **Copy**, or **Show**
   to see and select it.
4. Then, in Terminal on Kobol: `zsh $HOME/.unveiling/store-token.zsh --openalex`. It should print `ok`.

The key is free and needs no card. The pricing page says a free account gets "$1 of API usage per day
... no payment method required". The budget resets at midnight UTC (08:00 Taipei). One limit applies to
new accounts: they spend their first $1 at most $0.10 every 5 minutes, which takes about 50 minutes of
steady use.

The key goes in the query parameter **`api_key`** (`...&api_key=<key>`). The page also accepts it as a
bearer token, `Authorization: Bearer <key>`. Sending it in the header keeps it out of URLs, which the run
records in `inputs`. SPEC 5.1 has the client add `api_key=` and strip it from `inputs`. Either form
works with the same budget.

OpenAlex's docs also offer a second route: an agent can request a key for a person by sending that
person's email to `POST https://api.openalex.org/api-keys`, and the person activates it from an emailed
link. I did not use it. Sending JL's email address to an outside service needs JL's own decision. A key
asked for that way can't be copied from Settings either: Settings shows only its last four characters,
and only the asker sees the whole key.
