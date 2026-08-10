import { Injectable } from '@nestjs/common'

type GraphModel = {
  deleteMany: (scope: Record<string, unknown>) => any
  insertMany: (docs: unknown[], options: { session: unknown }) => Promise<any[]>
}

@Injectable()
export class KnowledgeGraphService {
  async remove(scope: Record<string, unknown>, nodeModel: GraphModel, edgeModel: GraphModel) {
    await nodeModel.deleteMany(scope).exec()
    await edgeModel.deleteMany(scope).exec()
  }

  async replace<T>(options: {
    connectionOwner: any
    scope: Record<string, unknown>
    nodes: unknown[]
    edges: unknown[]
    nodeModel: GraphModel
    edgeModel: GraphModel
    serialize: (nodes: any[], edges: any[]) => T
  }): Promise<T> {
    const connection = options.connectionOwner?.db
    if (typeof connection?.startSession !== 'function') {
      throw new Error('Knowledge graph replacement requires MongoDB transaction support')
    }

    const session = await connection.startSession()
    if (typeof session?.withTransaction !== 'function') {
      await session?.endSession?.()
      throw new Error('Knowledge graph replacement requires MongoDB transaction support')
    }

    let result: T
    try {
      // “整图替换”必须在同一事务中完成，否则删旧图后任一步失败都会留下半张图。
      await session.withTransaction(async () => {
        // 先删边再删节点，兼容数据库可能存在的引用约束。
        await this.withSession(options.edgeModel.deleteMany(options.scope), session).exec()
        await this.withSession(options.nodeModel.deleteMany(options.scope), session).exec()

        const savedNodes = options.nodes.length > 0
          ? await options.nodeModel.insertMany(options.nodes, { session })
          : []
        const savedEdges = options.edges.length > 0
          ? await options.edgeModel.insertMany(options.edges, { session })
          : []

        result = options.serialize(savedNodes, savedEdges)
      })
      return result!
    } finally {
      await session.endSession()
    }
  }

  private withSession(query: any, session: any) {
    return typeof query?.session === 'function' ? query.session(session) : query
  }
}
