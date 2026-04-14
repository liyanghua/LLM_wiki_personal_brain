import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import AskWorkspacePage from "@/pages/ask/AskWorkspacePage.vue";
import AssetCandidatesPage from "@/pages/assets/AssetCandidatesPage.vue";
import EvalReportsPage from "@/pages/eval/EvalReportsPage.vue";
import ProfileWorkspacePage from "@/pages/profile/ProfileWorkspacePage.vue";
import WikiExplorerPage from "@/pages/wiki/WikiExplorerPage.vue";
import WritebackReviewPage from "@/pages/writeback/WritebackReviewPage.vue";

function mountWorkbench(component: unknown) {
  return mount(component as never, {
    global: {
      plugins: [createPinia()],
      stubs: {
        VChart: {
          template: "<div>chart</div>",
        },
      },
    },
  });
}

describe("brain workbench pages - 业务化中文", () => {
  it("renders the ask workspace with business-oriented header", () => {
    const wrapper = mountWorkbench(AskWorkspacePage);
    expect(wrapper.text()).toContain("问题分析");
  });

  it("mounts all six pages with Chinese titles", () => {
    expect(mountWorkbench(WritebackReviewPage).text()).toContain("知识沉淀");
    expect(mountWorkbench(AssetCandidatesPage).text()).toContain("资产候选");
    expect(mountWorkbench(ProfileWorkspacePage).text()).toContain("分析画像");
    expect(mountWorkbench(EvalReportsPage).text()).toContain("评估看板");
    expect(mountWorkbench(WikiExplorerPage).text()).toContain("知识地图");
  });
});
