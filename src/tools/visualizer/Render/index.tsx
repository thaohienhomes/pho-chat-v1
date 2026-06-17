'use client';

import dynamic from 'next/dynamic';
import { memo } from 'react';

import { BuiltinRenderProps } from '@/types/tool';

import { VisualizerApiNames } from '../apis';

const VisualizerWidget = dynamic(() => import('./VisualizerWidget'), { ssr: false });

interface ShowWidgetArgs {
  i_have_seen_read_me?: boolean;
  loading_messages?: string[];
  title?: string;
  widget_code?: string;
}

/**
 * Builtin render for `pho-visualizer` tool.
 *
 * - show_widget → renders VisualizerRenderer inside an iframe sandbox
 * - visualizer_read_me → silent, returns null (guidelines are consumed by LLM only)
 */
const VisualizerRender = memo<BuiltinRenderProps>(({ apiName, args, messageId }) => {
  // visualizer_read_me is silent — no UI
  if (apiName === VisualizerApiNames.visualizerReadMe) {
    return null;
  }

  // show_widget: render the widget
  if (apiName === VisualizerApiNames.showWidget) {
    const { widget_code, title, loading_messages } = (args || {}) as ShowWidgetArgs;

    // If no widget_code yet (still streaming args), show nothing
    if (!widget_code) return null;

    return (
      <VisualizerWidget
        loadingMessages={loading_messages || []}
        messageId={messageId}
        title={title || 'visualization'}
        widgetCode={widget_code}
      />
    );
  }

  return null;
});

VisualizerRender.displayName = 'VisualizerRender';

export default VisualizerRender;
