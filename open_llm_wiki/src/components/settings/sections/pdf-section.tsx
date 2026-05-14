import { useTranslation } from "react-i18next"
import type { DraftSetter, SettingsDraft } from "@/components/settings/settings-types"
import { Label } from "@/components/ui/label"

interface PdfSectionProps {
  draft: SettingsDraft
  setDraft: DraftSetter
}

export function PdfSection({ draft, setDraft }: PdfSectionProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t("settings.sections.pdf.title", "PDF 文档理解")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "settings.sections.pdf.description",
            "为业务 PDF 选择默认解析策略。增强后端会优先保留版面结构、图文块和表格；不可用时系统会自动回退。",
          )}
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/20 p-4">
        <Label>{t("settings.sections.pdf.backendLabel", "默认 PDF 后端")}</Label>
        <select
          className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          value={draft.pdfBackendMode}
          onChange={(event) => setDraft("pdfBackendMode", event.target.value as SettingsDraft["pdfBackendMode"])}
        >
          <option value="opendataloader">
            {t("settings.sections.pdf.backendEnhanced", "增强后端优先（推荐）")}
          </option>
          <option value="pdfium">
            {t("settings.sections.pdf.backendFallback", "仅使用内置 pdfium")}
          </option>
        </select>
        <div className="rounded-xl bg-white/70 px-3 py-3 text-sm leading-6 text-muted-foreground">
          <p>
            {t(
              "settings.sections.pdf.backendHint1",
              "增强后端会优先尝试更细的页面区块、表格、OCR 与图像证据；如果本机没有准备好，会自动回退到内置 pdfium。",
            )}
          </p>
          <p className="mt-2">
            {t(
              "settings.sections.pdf.backendHint2",
              "系统会在导入过程和业务修订工作台里明确显示当前使用的后端，以及是否发生了降级。",
            )}
          </p>
        </div>
      </div>
    </div>
  )
}
