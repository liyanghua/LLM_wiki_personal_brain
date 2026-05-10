import { readFile, writeFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import {
  BUSINESS_TEMPLATE_PURPOSE,
  BUSINESS_TEMPLATE_SCHEMA,
  LEGACY_BUSINESS_TEMPLATE_PURPOSE,
  LEGACY_BUSINESS_TEMPLATE_SCHEMA,
  LEGACY_GENERIC_PROJECT_PURPOSE,
  LEGACY_GENERIC_PROJECT_SCHEMA,
} from "@/lib/templates"

async function tryRead(path: string): Promise<string> {
  try {
    return await readFile(path)
  } catch {
    return ""
  }
}

function sameContent(a: string, b: string): boolean {
  return a.trim() === b.trim()
}

export async function upgradeProjectDocsIfLegacy(projectPath: string): Promise<void> {
  const pp = normalizePath(projectPath)
  const purposePath = `${pp}/purpose.md`
  const schemaPath = `${pp}/schema.md`

  const [purpose, schema] = await Promise.all([tryRead(purposePath), tryRead(schemaPath)])

  const shouldUpgradePurpose =
    sameContent(purpose, LEGACY_BUSINESS_TEMPLATE_PURPOSE) ||
    sameContent(purpose, LEGACY_GENERIC_PROJECT_PURPOSE)
  const shouldUpgradeSchema =
    sameContent(schema, LEGACY_BUSINESS_TEMPLATE_SCHEMA) ||
    sameContent(schema, LEGACY_GENERIC_PROJECT_SCHEMA)

  await Promise.all([
    shouldUpgradePurpose ? writeFile(purposePath, BUSINESS_TEMPLATE_PURPOSE) : Promise.resolve(),
    shouldUpgradeSchema ? writeFile(schemaPath, BUSINESS_TEMPLATE_SCHEMA) : Promise.resolve(),
  ])
}
