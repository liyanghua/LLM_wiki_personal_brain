import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "@/app/router";
import "@/shared/styles/tokens.css";
import "@/shared/styles/theme.css";
import "@/shared/styles/workbench.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.mount("#app");
