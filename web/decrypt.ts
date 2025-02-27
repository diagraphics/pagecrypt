import { base64 } from 'rfc4648'
import queryString from "query-string";
import { url } from 'inspector';

const find = document.querySelector.bind(document)
const [pwd, header, msg, form, load] = [
    'input',
    'header',
    '#msg',
    'form',
    '#load',
].map(find)

let salt: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array

document.addEventListener('DOMContentLoaded', async () => {
    const pl = find('pre').innerText
    if (!pl) {
        pwd.disabled = true
        error('No encrypted payload.')
        return
    }

    const bytes = base64.parse(pl)
    salt = bytes.slice(0, 32)
    iv = bytes.slice(32, 32 + 16)
    ciphertext = bytes.slice(32 + 16)


    /**
     * TODO: Revise this comment
     *
     * Allow passwords to be automatically provided via the URI Fragment.
     * This greatly improves UX by clicking links instead of having to copy and paste the password manually.
     * It also does not compromise security since the URI Fragment is not sent across the internet.
     * Additionally, we delete the URI Fragment from the browser address field when the page is loaded.
     *
     * NOTE: However, beware that the password remains as a history entry if you use magic links!
     * Feel free to submit a PR if you know a workaround for this.
     *
     * SEE: https://stackoverflow.com/questions/26793130/history-replacestate-still-adds-entries-to-the-browsing-history
     *
     */
    if (window.location.hash) {
        const url = new URL(window.location.href);
        const hash = url.hash.slice(1)

        /* Hack to use URL to parse just a query-stringlike */
        const infix = hash.includes("=") && !hash.includes("?") ? "?" : "";
        const pseudoURL = new URL("hash:" + infix + hash);
        const query = pseudoURL.searchParams;

        if (query.has("pwd")) {
            pwd.value = query.get("pwd")!
            query.delete("pwd");

            const newHash = pseudoURL.href.slice(5);
            url.hash = newHash;
        } else if (
            /* Hash is neither query-like not path-like */
            !pseudoURL.search &&
            !pseudoURL.pathname.includes("/")
        ) {
            pwd.value = hash;
            url.hash = '';
        }

        history.replaceState(null, "", url.toString())
    }

    if (sessionStorage.k || pwd.value) {
        await decrypt()
    } else {
        hide(load)
        show(form)
        header.classList.replace('hidden', 'flex')
        pwd.focus()
    }
})

const subtle =
    window.crypto?.subtle ||
    (window.crypto as unknown as { webkitSubtle: Crypto['subtle'] })
        ?.webkitSubtle

if (!subtle) {
    error('Please use a modern browser.')
    pwd.disabled = true
}

function show(element: Element) {
    element.classList.remove('hidden')
}

function hide(element: Element) {
    element.classList.add('hidden')
}

function error(text: string) {
    msg.innerText = text
    header.classList.add('text-red-600')
}

form.addEventListener('submit', async (event) => {
    event.preventDefault()
    await decrypt()
})

async function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function decrypt() {
    load.lastElementChild.innerText = 'Decrypting...'
    hide(header)
    hide(form)
    show(load)
    await sleep(60)

    try {
        const decrypted = await decryptFile({ salt, iv, ciphertext }, pwd.value)

        document.write(decrypted)
        document.close()
    } catch (e) {
        hide(load)
        show(form)
        header.classList.replace('hidden', 'flex')

        if (sessionStorage.k) {
            // Delete invalid key
            sessionStorage.removeItem('k')
        } else {
            // Only show when user actually entered a password themselves.
            error('Wrong password.')
        }

        pwd.value = ''
        pwd.focus()
    }
}

async function deriveKey(
    salt: Uint8Array,
    password: string,
): Promise<CryptoKey> {
    const encoder = new TextEncoder()
    const baseKey = await subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey'],
    )
    return await subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations: 2e6, hash: 'SHA-256' },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        true,
        ['decrypt'],
    )
}

async function importKey(key: JsonWebKey) {
    return subtle.importKey('jwk', key, 'AES-GCM', true, ['decrypt'])
}

async function decryptFile(
    {
        salt,
        iv,
        ciphertext,
    }: { salt: Uint8Array; iv: Uint8Array; ciphertext: Uint8Array },
    password: string,
) {
    const decoder = new TextDecoder()

    const key = sessionStorage.k
        ? await importKey(JSON.parse(sessionStorage.k))
        : await deriveKey(salt, password)

    const data = new Uint8Array(
        await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext),
    )
    if (!data) throw 'Malformed data'

    // If no exception were thrown, decryption succeded and we can save the key.
    sessionStorage.k = JSON.stringify(await subtle.exportKey('jwk', key))

    return decoder.decode(data)
}
