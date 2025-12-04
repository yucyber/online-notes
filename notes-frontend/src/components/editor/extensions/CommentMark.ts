import { Mark, mergeAttributes } from '@tiptap/core'

const CommentMark = Mark.create({
  name: 'commentMark',
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: element => element.getAttribute('data-comment-id'),
        renderHTML: attributes => ({ 'data-comment-id': attributes.commentId })
      }
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-mark' }), 0]
  }
})

export default CommentMark

