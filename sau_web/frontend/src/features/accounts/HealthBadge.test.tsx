import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HealthBadge } from './HealthBadge'

describe('HealthBadge', () => {
  it('renders 健康 for valid health', () => {
    render(<HealthBadge health="valid" />)
    expect(screen.getByText('健康')).toBeInTheDocument()
  })

  it('renders 即将过期 for expiring_soon health', () => {
    render(<HealthBadge health="expiring_soon" />)
    expect(screen.getByText('即将过期')).toBeInTheDocument()
  })

  it('renders 已失效 for invalid health', () => {
    render(<HealthBadge health="invalid" />)
    expect(screen.getByText('已失效')).toBeInTheDocument()
  })

  it('renders 未检查 for unknown health', () => {
    render(<HealthBadge health="unknown" />)
    expect(screen.getByText('未检查')).toBeInTheDocument()
  })

  it('defaults to unknown when health is undefined', () => {
    render(<HealthBadge />)
    expect(screen.getByText('未检查')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const { container } = render(<HealthBadge health="valid" className="custom-class" />)
    expect(container.querySelector('span')?.classList.contains('custom-class')).toBe(true)
  })

  it('exposes data-tone attribute for styling assertions', () => {
    const { rerender } = render(<HealthBadge health="valid" />)
    expect(screen.getByText('健康')).toHaveAttribute('data-tone', 'valid')

    rerender(<HealthBadge health="expiring_soon" />)
    expect(screen.getByText('即将过期')).toHaveAttribute('data-tone', 'expiring_soon')

    rerender(<HealthBadge health="invalid" />)
    expect(screen.getByText('已失效')).toHaveAttribute('data-tone', 'invalid')

    rerender(<HealthBadge health="unknown" />)
    expect(screen.getByText('未检查')).toHaveAttribute('data-tone', 'unknown')
  })
})
