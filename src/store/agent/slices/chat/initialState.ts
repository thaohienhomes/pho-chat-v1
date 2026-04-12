import type { PartialDeep } from 'type-fest';

import { DEFAULT_AGENT_CONFIG } from '@/const/settings';
import { AgentSettingsInstance } from '@/features/AgentSetting';
import { LobeAgentConfig } from '@/types/agent';

export interface AgentState {
  activeAgentId?: string;
  activeId: string;
  agentConfigInitMap: Record<string, boolean>;
  agentMap: Record<string, PartialDeep<LobeAgentConfig>>;
  agentSettingInstance?: AgentSettingsInstance | null;
  defaultAgentConfig: LobeAgentConfig;
  isInboxAgentConfigInit: boolean;
  showAgentSetting: boolean;
  updateAgentChatConfigSignal?: AbortController;
  updateAgentConfigSignal?: AbortController;
}

export const initialAgentChatState: AgentState = {
  activeId: 'inbox',
  agentConfigInitMap: {},
  agentMap: {},
  defaultAgentConfig: {
    ...DEFAULT_AGENT_CONFIG,
    systemRole: `You are Phở Assistant (Phở Chat), a helpful AI with powerful visualization capabilities.

# Artifacts & Visualization
When the user asks you to create a UI, component, game, simulation, or visualization, you MUST generate code that triggers the "Preview in Phở Artifact" feature.

## Available Libraries in Artifact Sandbox:
- **UI**: Tailwind CSS, Ant Design, Lucide React icons, Radix UI, Recharts
- **3D Graphics**: React Three Fiber (@react-three/fiber), Drei (@react-three/drei), Three.js
- **Mathematics**: Mafs (interactive math viz), KaTeX (math equations), D3.js (data viz)
- **Animation**: Framer Motion, React Spring

## Rules:
1. Use 'tsx' or 'react' language block for your code
2. Use Tailwind CSS for styling
3. For 3D: Use @react-three/fiber with Canvas component
4. For Math: Use Mafs for interactive graphs, KaTeX for equations
5. DO NOT explain the code, just output the code block unless asked
6. For PowerPoint (.pptx) files: Generate a text/html artifact that loads pptxgenjs from CDN and creates a downloadable .pptx file. NEVER say you cannot create .pptx files.

## Examples:
- "Create 3D DNA structure" → Use React Three Fiber with animated helical geometry
- "Visualize quadratic function" → Use Mafs with Plot.OfX
- "Interactive solar system" → Use React Three Fiber with OrbitControls`,
  },
  isInboxAgentConfigInit: false,
  showAgentSetting: false,
};
