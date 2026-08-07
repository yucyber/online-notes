export const DEFAULT_MIND_ELIXIR_DATA = {
  nodeData: {
    id: 'root',
    topic: '新建思维导图',
    root: true,
    children: [],
  },
  linkData: {},
}

export function normalizeMindElixirData(initialData: any) {
  if (initialData && typeof initialData === 'object') {
    if (initialData.nodeData) return initialData
    if (initialData.root) {
      return {
        nodeData: {
          id: 'root',
          topic: initialData.root.topic || '新建思维导图',
          root: true,
          children: initialData.root.children || [],
        },
        linkData: {},
      }
    }
  }
  return DEFAULT_MIND_ELIXIR_DATA
}

export function cloneMindElixirData(data: any) {
  try {
    const stringified = JSON.stringify(data)
    return stringified
      ? JSON.parse(stringified)
      : { nodeData: { id: 'root', topic: '新建思维导图', root: true, children: [] }, linkData: {} }
  } catch (error) {
    console.error('Data sanitization failed:', error)
    return { nodeData: { id: 'root', topic: 'Error', root: true, children: [] }, linkData: {} }
  }
}

export function transformAiMindMapData(mindMapData: any) {
  if (mindMapData?.nodeData) return mindMapData

  const transformNode = (node: any): any => ({
    topic: node.content,
    id: node.id || 'node_' + Math.random().toString(36).substr(2, 9),
    children: node.children ? node.children.map(transformNode) : [],
  })

  return {
    nodeData: {
      topic: mindMapData?.root || 'AI Result',
      id: 'root',
      children: (mindMapData?.nodes || []).map(transformNode),
    },
    linkData: {},
  }
}

export function buildMindElixirOptions(el: HTMLElement, data: any, readonly: boolean, direction: number) {
  return {
    el,
    direction: direction as 0 | 1 | 2,
    data,
    draggable: !readonly,
    contextMenu: !readonly,
    toolBar: !readonly,
    nodeMenu: !readonly,
    keypress: !readonly,
    editable: !readonly,
    locale: 'zh_CN' as any,
  }
}

export function decorateMindElixirImages(container: HTMLElement | null, mindElixir: any) {
  const topicNodes = container?.querySelectorAll('me-tp, .mind-elixir-node')
  topicNodes?.forEach((node) => {
    const id = node.getAttribute('data-nodeid')
    if (!id) return

    const nodeData = mindElixir.nodeDataMap[id]
    if (!nodeData?.data?.image || node.querySelector('img')) return

    const img = document.createElement('img')
    img.src = nodeData.data.image
    img.style.maxWidth = '120px'
    img.style.display = 'block'
    img.style.marginTop = '5px'
    node.appendChild(img)
  })
}
