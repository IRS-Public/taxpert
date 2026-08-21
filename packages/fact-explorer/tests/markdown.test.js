import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../src/util/markdown.js'

describe('util/markdown renderMarkdown', () => {
  it('renders inline code and bold, escaping content', () => {
    expect(renderMarkdown('use `<x>` and **bold**')).toBe(
      'use <code>&lt;x&gt;</code> and <strong>bold</strong>'
    )
  })

  it('renders ## and ### headings', () => {
    expect(renderMarkdown('## Title')).toBe('<h3>Title</h3>')
    expect(renderMarkdown('### Sub')).toBe('<h4>Sub</h4>')
  })

  it('renders unordered lists', () => {
    expect(renderMarkdown('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>')
  })

  it('renders ordered lists', () => {
    expect(renderMarkdown('1. one\n2. two')).toBe('<ol><li>one</li><li>two</li></ol>')
  })

  it('renders fenced code blocks with escaped content', () => {
    expect(renderMarkdown('```\n<a> & b\n```')).toBe('<pre><code>&lt;a&gt; &amp; b</code></pre>')
  })

  it('joins paragraph lines with <br> and trims trailing breaks', () => {
    expect(renderMarkdown('line one\nline two')).toBe('line one<br>line two')
    expect(renderMarkdown('only')).toBe('only')
  })

  it('emits a <br> for blank lines between paragraphs', () => {
    expect(renderMarkdown('a\n\nb')).toBe('a<br><br>b')
  })
})
