import { useTranslation } from "react-i18next"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SettingsDraft, DraftSetter } from "../settings-types"

interface Props {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function WebSearchSection({ draft, setDraft }: Props) {
  const { t } = useTranslation()
  const options = [
    { value: "none" as const, label: "Disabled" },
    { value: "tavily" as const, label: "Tavily" },
    { value: "firecrawl" as const, label: "Firecrawl" },
  ]
  const researchOptions = [
    { value: "firecrawl" as const, label: "Firecrawl" },
    { value: "tavily" as const, label: "Tavily" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.webSearch.title")} (Deep Research)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.sections.webSearch.description")}
        </p>
      </div>

      <div className="space-y-2">
        <Label>{t("settings.sections.webSearch.provider", { defaultValue: "Search Provider" })}</Label>
        <div className="flex flex-wrap gap-2">
          {options.map((p) => {
            const active = draft.searchProvider === p.value
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setDraft("searchProvider", p.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
      </div>

      {draft.searchProvider !== "none" && (
        <div className="space-y-2">
          <Label>{draft.searchProvider === "firecrawl" ? "API Key (Firecrawl)" : "API Key"}</Label>
          <Input
            type="password"
            value={draft.searchApiKey}
            onChange={(e) => setDraft("searchApiKey", e.target.value)}
            placeholder={draft.searchProvider === "firecrawl"
              ? "Enter your Firecrawl API key (firecrawl.dev)"
              : "Enter your Tavily API key (tavily.com)"}
          />
        </div>
      )}

      <div className="space-y-2 border-t pt-4">
        <Label>Deep Research Backend</Label>
        <div className="flex flex-wrap gap-2">
          {researchOptions.map((p) => {
            const active = draft.researchProvider === p.value
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => setDraft("researchProvider", p.value)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border hover:bg-accent"
                }`}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <p className="text-sm text-muted-foreground">
          深度研究工作台默认优先走 Firecrawl，用于搜索和整页抓取；轻量搜索仍可继续用 Tavily。
        </p>
      </div>

      {draft.researchProvider === "firecrawl" && (
        <>
          <div className="space-y-2">
            <Label>Firecrawl API Key</Label>
            <Input
              type="password"
              value={draft.firecrawlApiKey}
              onChange={(e) => setDraft("firecrawlApiKey", e.target.value)}
              placeholder="Enter your Firecrawl API key (firecrawl.dev)"
            />
          </div>
          <div className="space-y-2">
            <Label>Firecrawl Base URL</Label>
            <Input
              value={draft.firecrawlBaseUrl}
              onChange={(e) => setDraft("firecrawlBaseUrl", e.target.value)}
              placeholder="https://api.firecrawl.dev"
            />
          </div>
        </>
      )}
    </div>
  )
}
