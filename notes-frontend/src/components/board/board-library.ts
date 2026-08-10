import { convertToExcalidrawElements } from '@excalidraw/excalidraw'

const getElementsBounds = (elements: any[]) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  elements.forEach((element) => {
    minX = Math.min(minX, element.x)
    minY = Math.min(minY, element.y)
    maxX = Math.max(maxX, element.x + element.width)
    maxY = Math.max(maxY, element.y + element.height)
  })
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

export function replaceWithLibraryItems(elements: any[], libraryItems: any[]) {
  if (!libraryItems || libraryItems.length === 0) return elements
  const libraryMap = new Map<string, any[]>()
  libraryItems.forEach((item) => {
    if (item.name) libraryMap.set(item.name.toLowerCase().trim(), item.elements)
  })
  if (libraryMap.size === 0) return elements

  const elementsToRemove = new Set<string>()
  const elementsToAdd: any[] = []
  elements.forEach((element) => {
    if (element.type !== 'text') return
    const normalizedText = String(element.text || '').toLowerCase().replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim()
    const bestMatchName = Array.from(libraryMap.keys())
      .filter((name) => normalizedText.includes(name))
      .sort((left, right) => right.length - left.length)[0]
    if (!bestMatchName) return

    const libraryElements = libraryMap.get(bestMatchName) || []
    const textCx = element.x + element.width / 2
    const textCy = element.y + element.height / 2
    const { minX, minY, width, height } = getElementsBounds(libraryElements)
    const offsetX = textCx - (minX + width / 2)
    const offsetY = textCy - (minY + height / 2)
    const newGroupId = `group_${Math.random().toString(36).slice(2, 11)}`
    const oldGroupIdsMap = new Map<string, string>()
    const placedLibraryElements = libraryElements.map((libraryElement: any) => {
      const groupIds = libraryElement.groupIds?.length > 0
        ? libraryElement.groupIds.map((groupId: string) => {
          if (!oldGroupIdsMap.has(groupId)) oldGroupIdsMap.set(groupId, `group_${Math.random().toString(36).slice(2, 11)}`)
          return oldGroupIdsMap.get(groupId)
        })
        : [newGroupId]
      return { ...libraryElement, id: `${libraryElement.id}_${Math.random().toString(36).slice(2, 11)}`, x: libraryElement.x + offsetX, y: libraryElement.y + offsetY, groupIds, seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31) }
    })
    elementsToAdd.push(...placedLibraryElements)

    if (element.groupIds?.length > 0) {
      const groupId = element.groupIds[0]
      elements.forEach((other: any) => { if (other.groupIds?.includes(groupId)) elementsToRemove.add(other.id) })
    } else {
      elementsToRemove.add(element.id)
      const cx = element.x + element.width / 2
      const cy = element.y + element.height / 2
      const container = elements.find((other: any) => other.id !== element.id && ['rectangle', 'diamond', 'ellipse'].includes(other.type) && other.x <= cx && other.x + other.width >= cx && other.y <= cy && other.y + other.height >= cy)
      if (container) elementsToRemove.add(container.id)
    }
  })

  return convertToExcalidrawElements([...elements.filter((element) => !elementsToRemove.has(element.id)), ...elementsToAdd])
}
