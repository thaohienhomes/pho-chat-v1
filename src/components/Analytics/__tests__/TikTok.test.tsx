import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import TikTok from '../TikTok';

// Mock crypto-hash utilities
vi.mock('@/utils/crypto-hash', () => ({
  hashUserPII: vi.fn().mockResolvedValue({
    email: 'hashed-email',
    external_id: 'hashed-id',
  }),
}));

// Mock tiktok-events utilities
vi.mock('@/utils/tiktok-events', () => ({
  identifyTikTokUser: vi.fn(),
}));

// Mock Next.js Script component to avoid script execution in tests
vi.mock('next/script', () => ({
  default: ({ children, id, dangerouslySetInnerHTML, ...props }: any) => (
    <script
      data-script-content={dangerouslySetInnerHTML?.__html}
      data-testid="mocked-script"
      id={id}
      {...props}
    >
      {children}
    </script>
  ),
}));

describe('TikTok', () => {
  const mockTtq = {
    identify: vi.fn(),
    page: vi.fn(),
    track: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock window.ttq
    Object.defineProperty(window, 'ttq', {
      value: mockTtq,
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should render TikTok Pixel script when pixelId is provided', () => {
    const { container } = render(<TikTok pixelId="D4KRIFBC77U4IAHDO190" />);

    const script = container.querySelector('#tiktok-pixel');
    expect(script).toBeInTheDocument();
    expect(script?.getAttribute('id')).toBe('tiktok-pixel');

    // Check that the script contains the pixel ID and key TikTok functions
    const scriptContent = script?.getAttribute('data-script-content') || '';
    expect(scriptContent).toContain('D4KRIFBC77U4IAHDO190');
    expect(scriptContent).toContain('TiktokAnalyticsObject');
    expect(scriptContent).toContain('ttq');
  });

  it('should not render script when pixelId is not provided', () => {
    const { container } = render(<TikTok />);

    const script = container.querySelector('#tiktok-pixel');
    expect(script).not.toBeInTheDocument();
  });

  it('should not render script when pixelId is empty', () => {
    const { container } = render(<TikTok pixelId="" />);

    const script = container.querySelector('#tiktok-pixel');
    expect(script).not.toBeInTheDocument();
  });

  it('should identify user when user data is provided', async () => {
    const { identifyTikTokUser } = await import('@/utils/tiktok-events');
    const { hashUserPII } = await import('@/utils/crypto-hash');

    // Re-establish the resolved value here: afterEach restoreAllMocks() strips the
    // factory default, which would otherwise make hashUserPII resolve to undefined.
    vi.mocked(hashUserPII).mockResolvedValue({
      email: 'hashed-email',
      external_id: 'hashed-id',
    });

    render(
      <TikTok
        pixelId="D4KRIFBC77U4IAHDO190"
        userEmail="test@example.com"
        userId="user123"
      />
    );

    await waitFor(() => {
      expect(hashUserPII).toHaveBeenCalledWith({
        email: 'test@example.com',
        phone: undefined,
        userId: 'user123',
      });
    });

    await waitFor(() => {
      expect(identifyTikTokUser).toHaveBeenCalledWith({
        email: 'hashed-email',
        external_id: 'hashed-id',
      });
    });
  });

  it('should not identify user when no user data is provided', async () => {
    const { identifyTikTokUser } = await import('@/utils/tiktok-events');

    render(<TikTok pixelId="D4KRIFBC77U4IAHDO190" />);

    await waitFor(() => {
      expect(identifyTikTokUser).not.toHaveBeenCalled();
    }, { timeout: 1000 });
  });

  it('should handle user identification errors gracefully', async () => {
    const { hashUserPII } = await import('@/utils/crypto-hash');
    vi.mocked(hashUserPII).mockRejectedValue(new Error('Hash failed'));

    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <TikTok
        pixelId="D4KRIFBC77U4IAHDO190"
        userEmail="test@example.com"
      />
    );

    await waitFor(() => {
      expect(console.error).toHaveBeenCalledWith(
        'Failed to identify TikTok user:',
        expect.any(Error)
      );
    });
  });
});
