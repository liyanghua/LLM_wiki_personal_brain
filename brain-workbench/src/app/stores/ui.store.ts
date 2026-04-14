import { defineStore } from "pinia";

export const useUiStore = defineStore("ui", {
  state: () => ({
    rightPanelCollapsed: false,
    bottomTrayTab: "evidence",
  }),
});
