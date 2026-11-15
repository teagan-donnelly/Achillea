import frontendConfig from "./frontend/vite.config";

// Support standard Vite tooling from the repository root as well as the workspace.
export default { ...frontendConfig, root: "frontend" };
