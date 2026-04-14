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

describe("brain workbench pages", () => {
  it("renders the ask workspace with five answer sections", () => {
    const wrapper = mountWorkbench(AskWorkspacePage);
    expect(wrapper.text()).toContain("Fact");
    expect(wrapper.text()).toContain("Synthesis");
    expect(wrapper.text()).toContain("Interpretation");
    expect(wrapper.text()).toContain("Recommendation");
    expect(wrapper.text()).toContain("Citations");
  });

  it("mounts the review and explorer pages", () => {
    expect(mountWorkbench(WritebackReviewPage).text()).toContain("Writeback");
    expect(mountWorkbench(AssetCandidatesPage).text()).toContain("Candidates");
    expect(mountWorkbench(ProfileWorkspacePage).text()).toContain("Method Profile");
    expect(mountWorkbench(EvalReportsPage).text()).toContain("Eval");
    expect(mountWorkbench(WikiExplorerPage).text()).toContain("Wiki");
  });
});
