import { useMemo } from 'react';

import { PENDING_MESSAGE_KEY } from '@/const/localStorage';
import { useAnalyticsSafe } from '@/hooks/useAnalyticsSafe';
import { useGeminiChineseWarning } from '@/hooks/useGeminiChineseWarning';
import { getAgentStoreState } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';
import { getChatStoreState, useChatStore } from '@/store/chat';
import { aiChatSelectors, chatSelectors, topicSelectors } from '@/store/chat/selectors';
import { fileChatSelectors, useFileStore } from '@/store/file';
import { getUserStoreState, useUserStore } from '@/store/user';

export interface UseSendMessageParams {
  isWelcomeQuestion?: boolean;
  onlyAddAIMessage?: boolean;
  onlyAddUserMessage?: boolean;
}

/**
 * Save pending message to localStorage for restoration after auth
 */
const savePendingMessage = (message: string, hasFiles: boolean) => {
  if (typeof window === 'undefined') return;

  const pendingData = {
    hasFiles,
    message,
    timestamp: Date.now(),
  };
  localStorage.setItem(PENDING_MESSAGE_KEY, JSON.stringify(pendingData));
};

export const useSend = () => {
  const [
    isContentEmpty,
    sendMessage,
    addAIMessage,
    stopGenerateMessage,
    cancelSendMessageInServer,
    generating,
    isSendButtonDisabledByMessage,
    isSendingMessage,
  ] = useChatStore((s) => [
    !s.inputMessage,
    s.sendMessage,
    s.addAIMessage,
    s.stopGenerateMessage,
    s.cancelSendMessageInServer,
    chatSelectors.isAIGenerating(s),
    chatSelectors.isSendButtonDisabledByMessage(s),
    aiChatSelectors.isCurrentSendMessageLoading(s),
  ]);
  const { analytics } = useAnalyticsSafe();
  const checkGeminiChineseWarning = useGeminiChineseWarning();

  // Auth state for checking if user is signed in
  const [isSignedIn, isLoaded, openLogin] = useUserStore((s) => [
    s.isSignedIn,
    s.isLoaded,
    s.openLogin,
  ]);

  // 使用订阅以保持最新文件列表
  const reactiveFileList = useFileStore(fileChatSelectors.chatUploadFileList);
  const [isUploadingFiles, clearChatUploadFileList] = useFileStore((s) => [
    fileChatSelectors.isUploadingFiles(s),
    s.clearChatUploadFileList,
  ]);

  const isInputEmpty = isContentEmpty && reactiveFileList.length === 0;

  const canNotSend =
    isInputEmpty || isUploadingFiles || isSendButtonDisabledByMessage || isSendingMessage;

  const handleSend = async (params: UseSendMessageParams = {}) => {
    if (canNotSend) return;

    const store = useChatStore.getState();
    const mainInputEditor = store.mainInputEditor;

    if (!mainInputEditor) {
      console.warn('not found mainInputEditor instance');
      return;
    }

    if (chatSelectors.isAIGenerating(store)) return;

    // Context window warning: warn when conversation is very long
    const LONG_CONVERSATION_THRESHOLD = 200;
    const messageCount = chatSelectors.activeBaseChats(store).length;
    if (messageCount >= LONG_CONVERSATION_THRESHOLD) {
      const warningKey = `__ctx_warn_${store.activeId}`;
      const alreadyWarned =
        typeof sessionStorage !== 'undefined' && sessionStorage.getItem(warningKey);

      if (!alreadyWarned) {
        // Dynamically import Modal to avoid bundling it in critical path
        const { Modal } = await import('antd');
        const shouldContinue = await new Promise<boolean>((resolve) => {
          Modal.confirm({
            cancelText: 'Tiếp tục',
            content: `Cuộc hội thoại đã có ${messageCount} tin nhắn. Điều này có thể ảnh hưởng đến chất lượng và tốc độ phản hồi AI. Bạn có muốn tạo cuộc hội thoại mới?`,
            okText: 'Tạo hội thoại mới',
            onCancel: () => resolve(true), // Continue in current conversation
            onOk: () => resolve(false), // Create new conversation
            title: '⚠️ Cuộc hội thoại dài',
          });
        });

        try {
          sessionStorage.setItem(warningKey, '1');
        } catch {
          // Safari private browsing
        }

        analytics?.track({
          name: 'long_conversation_warning_shown',
          properties: {
            chat_id: store.activeId,
            continued: shouldContinue,
            message_count: messageCount,
          },
        });

        if (!shouldContinue) {
          // User chose to create new conversation — navigate away
          window.location.href = '/chat';
          return;
        }
      }
    }

    const inputMessage = store.inputMessage;
    // 发送时再取一次最新的文件列表，防止闭包拿到旧值
    const fileList = fileChatSelectors.chatUploadFileList(useFileStore.getState());

    // if there is no message and no image, then we should not send the message
    if (!inputMessage && fileList.length === 0) return;

    // ============ AUTH CHECK ============
    // Wait briefly for Clerk to initialize if not loaded yet
    // Prevents race condition where message fires before auth state is known
    if (!isLoaded) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (getUserStoreState().isLoaded) return resolve();
          setTimeout(check, 100);
        };
        check();
        setTimeout(resolve, 3000); // Max 3s wait for Clerk CDN (slow in VN)
      });
    }

    // Re-read auth state (may have changed during wait)
    const authState = getUserStoreState();

    // If auth is loaded and user is not signed in, save message and trigger login
    if (authState.isLoaded && !authState.isSignedIn) {
      // Save the pending message to localStorage
      savePendingMessage(inputMessage, fileList.length > 0);

      // Trigger Clerk sign-in modal
      authState.openLogin?.();

      // Don't proceed with sending - user needs to authenticate first
      return;
    }
    // ====================================

    // Check for Chinese text warning with Gemini model
    const agentStore = getAgentStoreState();
    const currentModel = agentSelectors.currentAgentModel(agentStore);
    const shouldContinue = await checkGeminiChineseWarning({
      model: currentModel,
      prompt: inputMessage,
      scenario: 'chat',
    });

    if (!shouldContinue) return;

    if (params.onlyAddAIMessage) {
      addAIMessage();
    } else {
      sendMessage({ files: fileList, message: inputMessage, ...params });
    }

    clearChatUploadFileList();
    mainInputEditor.setExpand(false);
    mainInputEditor.clearContent();
    mainInputEditor.focus();

    // 获取分析数据
    const userStore = getUserStoreState();

    // 直接使用现有数据结构判断消息类型（支持 video）
    const hasImages = fileList.some((file) => file.file?.type?.startsWith('image'));
    const hasVideos = fileList.some((file) => file.file?.type?.startsWith('video'));
    const messageType =
      fileList.length === 0 ? 'text' : hasVideos ? 'video' : hasImages ? 'image' : 'file';

    analytics?.track({
      name: 'send_message',
      properties: {
        chat_id: store.activeId || 'unknown',
        current_topic: topicSelectors.currentActiveTopic(store)?.title || null,
        has_attachments: fileList.length > 0,
        history_message_count: chatSelectors.activeBaseChats(store).length,
        message: inputMessage,
        message_length: inputMessage.length,
        message_type: messageType,
        selected_model: agentSelectors.currentAgentModel(agentStore),
        session_id: store.activeId || 'inbox', // 当前活跃的会话ID
        user_id: userStore.user?.id || 'anonymous',
      },
    });
  };

  const stop = () => {
    const store = getChatStoreState();
    const generating = chatSelectors.isAIGenerating(store);

    if (generating) {
      stopGenerateMessage();
      return;
    }

    const isCreatingMessage = aiChatSelectors.isCurrentSendMessageLoading(store);

    if (isCreatingMessage) {
      cancelSendMessageInServer();
    }
  };

  return useMemo(
    () => ({
      disabled: canNotSend,
      generating: generating || isSendingMessage,
      send: handleSend,
      stop,
    }),
    [canNotSend, generating, isSendingMessage, stop, handleSend],
  );
};
