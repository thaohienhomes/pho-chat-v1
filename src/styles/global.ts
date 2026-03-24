import { Theme, css } from 'antd-style';

// fix ios input keyboard
// overflow: hidden;
// ref: https://zhuanlan.zhihu.com/p/113855026
export default ({ token }: { prefixCls: string; token: Theme }) => css`
  html,
  body,
  #__next {
    position: relative;

    overscroll-behavior: none;

    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;

    background: ${token.colorBgLayout};

    @media (min-device-width: 576px) {
      overflow: hidden;
    }
  }

  body {
    color: ${token.colorText};
  }

  /* Scrollbar styles removed — handled by AppTheme's scrollbar + scrollbarPolyfill classes
   * which are applied to the app container and inherited by children.
   * The previous * selector was duplicate and forced style matching on every DOM element. */

  /* ============================================
   * Dark Mode Text Visibility Improvements
   * ============================================ */

  /* Improve placeholder visibility in dark mode */
  ::placeholder {
    color: ${token.colorTextQuaternary} !important;
    opacity: 0.8 !important;
  }

  /* Guide card descriptions - make more visible */
  [class*='GuideCard'] [class*='desc'],
  [class*='guide'] [class*='desc'] {
    color: ${token.colorTextSecondary} !important;
  }

  /* Assistant card descriptions in welcome screen */
  [class*='AssistantCard'] p,
  [class*='assistant'] [class*='description'],
  [class*='WelcomeCard'] [class*='content'] {
    color: ${token.colorTextSecondary} !important;
  }

  /* Topic sidebar guide text */
  [class*='topic'] [class*='guide'],
  [class*='TopicList'] [class*='desc'] {
    color: ${token.colorTextSecondary} !important;
  }

  /* Improve disabled/muted text visibility */
  [class*='disabled'] span,
  [class*='muted'],
  [aria-disabled='true'] span {
    color: ${token.colorTextTertiary} !important;
  }

  /* Ensure input labels and helpers are visible */
  label,
  .ant-form-item-label > label {
    color: ${token.colorText} !important;
  }

  /* Secondary text improvements */
  [class*='secondary'],
  [class*='tertiary'],
  [class*='caption'] {
    color: ${token.colorTextSecondary} !important;
  }
`;
