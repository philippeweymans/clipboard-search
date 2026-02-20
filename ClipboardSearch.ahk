; ClipboardSearch.ahk (AHK v2)
; Searches clipboard across multiple AI engines, then collects responses via CDP
;
; Just run this script — it auto-launches a dedicated Chrome instance
; with its own profile (won't touch your main Chrome).
;
; FIRST RUN: You'll need to log in to each AI service once in the
; dedicated Chrome window. After that, sessions persist.
;
; HOTKEYS:
;   Win+Shift+S  = Send clipboard to all AI engines
;   Win+Shift+C  = Collect responses from open tabs (run manually if needed)

#Requires AutoHotkey v2.0
#SingleInstance Force  ; New instance always replaces the old one

; === CONFIGURATION ===
COLLECTOR_DIR := "C:\Users\phili\utilities\clipboard-search---multi-ai-query-response-collector"

; Dedicated Chrome for this tool — separate from your main browser
CHROME_EXE := "C:\Program Files\Google\Chrome\Application\chrome.exe"
CHROME_PROFILE := COLLECTOR_DIR "\chrome-profile"
CDP_PORT := 9222

; Delay (ms) before submitting prefill-only engines
PAGE_LOAD_DELAY := 5000

; Delay (ms) before starting the collector (let engines start generating)
COLLECT_DELAY := 5000

; === AUTO-START: Launch dedicated Chrome on script startup ===
EnsureChrome()

EnsureChrome() {
    global CHROME_EXE, CHROME_PROFILE, CDP_PORT

    ; Check if our dedicated Chrome is already running by trying CDP
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("GET", "http://127.0.0.1:" CDP_PORT "/json/version", false)
        whr.Send()
        if (whr.Status = 200) {
            TrayTip("Dedicated Chrome already running", "ClipboardSearch", "Iconi")
            return
        }
    } catch {
        ; Not running — launch it
    }

    Run('"' CHROME_EXE '" --remote-debugging-port=' CDP_PORT ' --user-data-dir="' CHROME_PROFILE '"')
    TrayTip("Launching dedicated Chrome (port " CDP_PORT ")...", "ClipboardSearch", "Iconi")
    Sleep(3000)
}

; Open a URL in the dedicated Chrome via CDP
CdpOpenTab(url) {
    global CDP_PORT
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("PUT", "http://127.0.0.1:" CDP_PORT "/json/new?" url, false)
        whr.Send()
    } catch as err {
        TrayTip("Failed to open tab: " err.Message, "ClipboardSearch", "Icon!")
    }
}

; === HOTKEY: Search all engines ===
#+s:: {  ; Win+Shift+S
    global COLLECTOR_DIR, PAGE_LOAD_DELAY, COLLECT_DELAY

    q := A_Clipboard
    if (q = "") {
        MsgBox("Clipboard is empty!", "ClipboardSearch", "Icon!")
        return
    }

    encoded := UriEncode(q)

    ; Open all 4 tabs via CDP
    CdpOpenTab("https://www.perplexity.ai/search?q=" encoded)
    Sleep(300)
    CdpOpenTab("https://chatgpt.com/?q=" encoded)
    Sleep(300)
    CdpOpenTab("https://aistudio.google.com/prompts/new_chat?prompt=" encoded)
    Sleep(300)
    CdpOpenTab("https://claude.ai/new?q=" encoded)

    TrayTip("Tabs opened — waiting for pages to load...", "ClipboardSearch", "Iconi")

    ; Wait for pages to load, then submit prefill engines via Node
    Sleep(PAGE_LOAD_DELAY)
    Run('cmd /c cd /d "' COLLECTOR_DIR '" && node submit.js', COLLECTOR_DIR, "Min")

    ; Start collector after a delay
    Sleep(COLLECT_DELAY)
    RunCollector()
}

; === HOTKEY: Collect responses manually ===
#+c:: {  ; Win+Shift+C
    RunCollector()
}

; === Run the Node.js collector ===
RunCollector() {
    global COLLECTOR_DIR
    Run(
        'cmd /c cd /d "' COLLECTOR_DIR '" && node collect.js --timeout 90',
        COLLECTOR_DIR,
        "Min"
    )
    TrayTip("Collecting responses...", "ClipboardSearch", "Iconi")
}

; === URI Encoding ===
UriEncode(str) {
    result := ""
    buf := Buffer(StrPut(str, "UTF-8"), 0)
    StrPut(str, buf, "UTF-8")
    loop buf.Size - 1 {
        byte := NumGet(buf, A_Index - 1, "UChar")
        if (byte >= 0x30 && byte <= 0x39)
            || (byte >= 0x41 && byte <= 0x5A)
            || (byte >= 0x61 && byte <= 0x7A)
            || (byte = 0x2D)
            || (byte = 0x2E)
            || (byte = 0x5F)
            || (byte = 0x7E)
            result .= Chr(byte)
        else
            result .= "%" Format("{:02X}", byte)
    }
    return result
}
