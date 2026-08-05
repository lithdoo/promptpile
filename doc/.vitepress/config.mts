export default {
  lang: 'zh-CN',
  title: 'Promptpile',
  description: 'File-native、CLI-first 的轻量 Agent Runtime 生态',
  base: '/promptpile/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://lithdoo.github.io/promptpile/' },
  themeConfig: {
    search: { provider: 'local' },
    outline: { level: [2, 3], label: '本页导航' },
    nav: [
      { text: '快速开始', link: '/25-guides/first-conversation' },
      { text: '架构', link: '/10-architecture/system-overview' },
      { text: '协议', link: '/15-contracts/README' },
      { text: '包', link: '/20-packages/README' },
      { text: '文档地图', link: '/README' }
    ],
    sidebar: [
      { text: '开始', items: [
        { text: '文档首页', link: '/' },
        { text: '完整文档地图', link: '/README' }
      ]},
      { text: '00 · 产品总览', items: [
        { text: '产品定位', link: '/00-overview/product-vision' },
        { text: '生态总览', link: '/00-overview/ecosystem-overview' },
        { text: '成熟度与范围', link: '/00-overview/maturity-and-scope' }
      ]},
      { text: '10 · 系统架构', items: [
        { text: '系统总览', link: '/10-architecture/system-overview' },
        { text: '边界模型', link: '/10-architecture/boundary-model' },
        { text: '执行系统', link: '/10-architecture/execution-system' },
        { text: '编排系统', link: '/10-architecture/orchestration-system' },
        { text: '工具执行系统', link: '/10-architecture/tool-execution-system' },
        { text: '上下文生命周期', link: '/10-architecture/context-lifecycle-system' }
      ]},
      { text: '15 · 正式契约', items: [
        { text: '契约目录', link: '/15-contracts/README' },
        { text: 'Conversation Protocol v1', link: '/15-contracts/conversation-protocol-v1' },
        { text: 'CLI Contract v1', link: '/15-contracts/cli-contract-v1' },
        { text: 'Tool Artifacts v1', link: '/15-contracts/tool-artifacts-v1' },
        { text: 'Tools TOML v1', link: '/15-contracts/tools-toml-v1' }
      ]},
      { text: '20 · Packages', items: [
        { text: '包目录', link: '/20-packages/README' },
        { text: 'promptpile', link: '/20-packages/promptpile' },
        { text: 'promptpile-react', link: '/20-packages/promptpile-react' },
        { text: 'promptpile-mcp', link: '/20-packages/promptpile-mcp' },
        { text: 'promptpile-compress', link: '/20-packages/promptpile-compress' },
        { text: 'promptpile-plan', link: '/20-packages/promptpile-plan' },
        { text: 'agent-lite-tools', link: '/20-packages/agent-lite-tools' }
      ]},
      { text: '25 · 使用指南', items: [
        { text: '第一次对话', link: '/25-guides/first-conversation' },
        { text: 'LLM Profiles', link: '/25-guides/llm-profiles' },
        { text: '工具调用', link: '/25-guides/tool-calling' },
        { text: 'ReAct Agent', link: '/25-guides/react-agent' },
        { text: 'MCP 工具', link: '/25-guides/mcp-tools' }
      ]},
      { text: '30 · 开发维护', items: [
        { text: '仓库布局', link: '/30-development/repository-layout' },
        { text: '测试策略', link: '/30-development/testing-strategy' },
        { text: '文档维护', link: '/30-development/documentation-maintenance' }
      ]},
      { text: '决策与追踪', items: [
        { text: 'ADR 0001 · File-native', link: '/decisions/0001-file-native-conversation' },
        { text: 'ADR 0002 · CLI-first', link: '/decisions/0002-cli-first-boundary' },
        { text: 'ADR 0003 · Tool execution outside core', link: '/decisions/0003-tool-execution-outside-core' },
        { text: '当前状态', link: '/tracking/current-status' }
      ]}
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/lithdoo/promptpile' }],
    editLink: { pattern: 'https://github.com/lithdoo/promptpile/edit/main/doc/:path', text: '在 GitHub 上编辑此页' },
    footer: { message: 'Promptpile documentation · ISC licensed project', copyright: 'Tracks the current main branch implementation.' }
  }
}
