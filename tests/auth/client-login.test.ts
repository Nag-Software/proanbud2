import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { completeClientLogin } from '../../lib/auth/client-login'

describe('completeClientLogin', () => {
  const refresh = vi.fn()
  const assign = vi.fn()

  beforeEach(() => {
    refresh.mockReset()
    assign.mockReset()
    vi.stubGlobal('window', { location: { assign } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refreshes router state then hard-navigates to destination', () => {
    completeClientLogin({ refresh } as never, '/create-company')

    expect(refresh).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledWith('/create-company')
  })

  it('defaults destination to home', () => {
    completeClientLogin({ refresh } as never)

    expect(assign).toHaveBeenCalledWith('/')
  })
})
