# Safety and limitations
Hackathon simulation — not for clinical use. Achillea is not a medical device or a clinically validated decision-support system. All names, IDs, observations, tasks, and chart entries are fictional.

Movement detection is not care confirmation. Dual-region changes cannot establish pressure redistribution, an effective repositioning, or injury prevention. Disconnected data means unknown. Nurse review and explicit bedside verification remain separate steps, and source provenance remains attached to observations and notes.

Task ordering uses visible deterministic demo rules: explicit priority, due state, then routine sequence. A flagged reading is a request to review synthetic data, not a diagnosis or treatment recommendation. The ICU care plan is a separate expansion example; no universal turning protocol is assigned to L&D patients.

No real hardware, hospital systems, patient information, EHR writes, enterprise SSO, production authorization, or AI provider is connected. The local demo nurse persona is not a secure authenticated clinical identity. No HIPAA, FDA, deployment compatibility, or clinical efficacy claims are made.

Production requires hospital approvals, identity/access controls, patient matching, device and clinical validation, privacy review, secured networks, EHR integration, mobile management, backup/retention policy, and usability evaluation. Unsaved text is retained only within the browser tab; saved drafts persist in PostgreSQL. The local development adapter binds 127.0.0.1; hosted deployment uses Vercel functions with a private demo login. This shared-password gate does not establish a clinical identity. Do not enter real patient data.
