import { useRef, useState, useCallback, useEffect } from "react"
import { Send, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { isImeComposing } from "@/lib/keyboard-utils"
import type { ComposerRequest } from "@/stores/chat-store"

interface ChatInputProps {
  onSend: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
  label?: string
  hint?: string
  embedded?: boolean
  prefillRequest?: ComposerRequest | null
  focusRequest?: ComposerRequest | null
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  placeholder,
  label,
  hint,
  embedded = false,
  prefillRequest = null,
  focusRequest = null,
}: ChatInputProps) {
  const [value, setValue] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const appliedPrefillRequestIdRef = useRef<string | null>(null)
  const appliedFocusRequestIdRef = useRef<string | null>(null)

  const syncTextareaHeight = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${Math.min(textarea.scrollHeight, embedded ? 144 : 160)}px`
  }, [embedded])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    syncTextareaHeight(e.target)
  }, [syncTextareaHeight])

  const handleSend = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || isStreaming) return
    onSend(trimmed)
    setValue("")
    if (textareaRef.current) {
      syncTextareaHeight(textareaRef.current)
    }
  }, [value, isStreaming, onSend, syncTextareaHeight])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Don't submit on the Enter that commits an IME candidate —
      // the user is mid-composition (Chinese / Japanese / Korean
      // input method picking an English word or phrase) and would
      // see the message fire before they finished typing.
      if (isImeComposing(e)) return
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const hasValue = value.trim().length > 0

  useEffect(() => {
    if (!prefillRequest?.id) return
    if (appliedPrefillRequestIdRef.current === prefillRequest.id) return
    appliedPrefillRequestIdRef.current = prefillRequest.id
    if (typeof prefillRequest.text !== "string") return
    setValue(prefillRequest.text)
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      syncTextareaHeight(textarea)
      textarea.focus({ preventScroll: true })
      textarea.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
      if (prefillRequest.selectAll) {
        textarea.setSelectionRange(0, textarea.value.length)
      } else {
        const caret = textarea.value.length
        textarea.setSelectionRange(caret, caret)
      }
    })
  }, [prefillRequest, syncTextareaHeight])

  useEffect(() => {
    if (!focusRequest?.id) return
    if (appliedFocusRequestIdRef.current === focusRequest.id) return
    appliedFocusRequestIdRef.current = focusRequest.id
    requestAnimationFrame(() => {
      const textarea = textareaRef.current
      if (!textarea) return
      syncTextareaHeight(textarea)
      textarea.focus({ preventScroll: true })
      textarea.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
      if (!prefillRequest?.selectAll) {
        const caret = textarea.value.length
        textarea.setSelectionRange(caret, caret)
      }
    })
  }, [focusRequest, prefillRequest?.selectAll, syncTextareaHeight, value])

  if (embedded) {
    return (
      <div className="border-t border-zinc-200 bg-white px-4 py-3">
        <div className="rounded-[20px] border border-zinc-200 bg-zinc-50 transition-all focus-within:border-amber-300 focus-within:bg-white focus-within:shadow-[0_14px_30px_-24px_rgba(217,119,6,0.45)]">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                {label ?? "输入区"}
              </p>
              <p className="mt-1 text-xs leading-5 text-zinc-500">
                {hint ?? "Enter 发送，Shift+Enter 换行。"}
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-zinc-500">
              {isStreaming ? "生成中，可随时停止" : hasValue ? "准备发送" : "等待输入"}
            </span>
          </div>

          <div className="flex items-end gap-3 px-3 py-3">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder={placeholder ?? "请输入内容..."}
              disabled={isStreaming}
              rows={2}
              className="min-h-[72px] flex-1 resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm leading-6 text-zinc-800 placeholder:text-zinc-400 focus:border-amber-300 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              style={{ maxHeight: "144px", overflowY: "auto" }}
            />
            {isStreaming ? (
              <Button
                variant="destructive"
                size="icon"
                onClick={onStop}
                className="h-11 w-11 shrink-0 rounded-2xl shadow-sm"
                title="停止生成"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={handleSend}
                disabled={!hasValue}
                className="h-11 w-11 shrink-0 rounded-2xl bg-zinc-900 text-white shadow-sm hover:bg-zinc-800"
                title="发送消息"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-zinc-200 bg-[linear-gradient(180deg,rgba(250,250,249,0.96),rgba(255,255,255,0.98))] px-4 py-3">
      <div className="rounded-[22px] border border-zinc-300 bg-white shadow-[0_10px_28px_-18px_rgba(24,24,27,0.45)] transition-all focus-within:border-amber-300 focus-within:shadow-[0_18px_36px_-22px_rgba(217,119,6,0.5)] focus-within:ring-4 focus-within:ring-amber-100/80">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-100 px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
              {label ?? "输入区"}
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-500">
              {hint ?? "Enter 发送，Shift+Enter 换行。"}
            </p>
          </div>
          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] text-zinc-500">
            {isStreaming ? "生成中，可随时停止" : hasValue ? "准备发送" : "等待输入"}
          </span>
        </div>

        <div className="flex items-end gap-3 px-3 py-3">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={placeholder ?? "请输入内容..."}
            disabled={isStreaming}
            rows={3}
            className="min-h-[88px] flex-1 resize-none rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm leading-6 text-zinc-800 placeholder:text-zinc-400 focus:border-amber-300 focus:bg-white focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            style={{ maxHeight: "160px", overflowY: "auto" }}
          />
          {isStreaming ? (
            <Button
              variant="destructive"
              size="icon"
              onClick={onStop}
              className="h-11 w-11 shrink-0 rounded-2xl shadow-sm"
              title="停止生成"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!hasValue}
              className="h-11 w-11 shrink-0 rounded-2xl bg-zinc-900 text-white shadow-sm hover:bg-zinc-800"
              title="发送消息"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
