import { V1Config, V1ConfigState } from '@/migrations/FromV1ToV2/types/v1';
import { MigrationData, VersionController } from '@/migrations/VersionController';

import inputV1Data from './fixtures/input-v1-session.json';
import outputV2Data from './fixtures/output-v2.json';
import { MigrationV1ToV2 } from './index';

describe('MigrationV1ToV2', () => {
  let migrations;
  let versionController: VersionController<any>;

  beforeEach(() => {
    migrations = [MigrationV1ToV2];
    versionController = new VersionController(migrations, 2);
  });

  it('should migrate data correctly through multiple versions', () => {
    const data: MigrationData = inputV1Data;

    const migratedData = versionController.migrate(data);

    expect(migratedData.version).toEqual(outputV2Data.version);
    expect(migratedData.state.sessions).toEqual(outputV2Data.state.sessions);
    expect(migratedData.state.topics).toEqual(outputV2Data.state.topics);
    expect(migratedData.state.messages).toEqual(outputV2Data.state.messages);
  });

  it('should work correctly with session with no topic', () => {
    const data: MigrationData<V1ConfigState> = {
      state: {
        sessions: {
          'f8a620ef-c44f-403e-892c-e97fb745255e': {
            chats: {},
            config: {
              displayMode: 'chat',
              model: 'gpt-3.5-turbo',
              params: {
                temperature: 0.6,
              },
              plugins: [],
              systemRole:
                '你是一名前端专家。现在我们正在实现一个 zustand store。该store包含 agents、chats、sessionTree 三个关键的数据。它们的类型定义如下：\n\n```ts\n\n\nexport interface ChatSessionState {\n  sessionTree: SessionTree[];\n  chats: ChatContextMap;\n  agents: ChatAgentMap;\n}\n\ninterface SessionTree {\n  agentId: string;\n  chats: string[];\n}\n\nexport type ChatContextMap = Record<string, ChatContext>;\nexport type ChatAgentMap = Record<string, ChatAgent>;\n\n```',
            } as unknown as V1Config,
            createAt: 1_690_016_491_289,
            id: 'f8a620ef-c44f-403e-892c-e97fb745255e',
            meta: {
              avatar: '输出: 🧪',
              description: '你需要实现一个 zustand store 的功能',
              title: '前端 zustand store 专家',
            },
            type: 'agent',
            updateAt: 1_690_016_491_289,
          },
        },
      },
      version: 1,
    };

    const migratedData = versionController.migrate(data);
    expect(migratedData.version).toEqual(2);
    expect(migratedData.state.sessions).toEqual([
      {
        config: {
          displayMode: 'chat',
          model: 'gpt-3.5-turbo',
          params: {
            temperature: 0.6,
          },
          plugins: [],
          systemRole:
            '你是一名前端专家。现在我们正在实现一个 zustand store。该store包含 agents、chats、sessionTree 三个关键的数据。它们的类型定义如下：\n\n```ts\n\n\nexport interface ChatSessionState {\n  sessionTree: SessionTree[];\n  chats: ChatContextMap;\n  agents: ChatAgentMap;\n}\n\ninterface SessionTree {\n  agentId: string;\n  chats: string[];\n}\n\nexport type ChatContextMap = Record<string, ChatContext>;\nexport type ChatAgentMap = Record<string, ChatAgent>;\n\n```',
        },
        createdAt: 1_690_016_491_289,
        group: 'default',
        id: 'f8a620ef-c44f-403e-892c-e97fb745255e',
        meta: {
          avatar: '输出: 🧪',
          description: '你需要实现一个 zustand store 的功能',
          title: '前端 zustand store 专家',
        },
        type: 'agent',
        updatedAt: 1_690_016_491_289,
      },
    ]);
  });

  it('should add inbox messages', () => {
    const data: MigrationData<V1ConfigState> = {
      state: {
        inbox: {
          chats: {
            HD4krtKa: {
              content: '1',
              createAt: 1_692_891_912_689,
              id: 'HD4krtKa',
              meta: {},
              role: 'user',
              topicId: 'jvfmUEwF',
              updateAt: 1_693_114_820_406,
            },
            K4AVcvGB: {
              content: '2',
              createAt: 1_692_891_912_699,
              extra: { fromModel: 'gpt-3.5-turbo' },
              id: 'K4AVcvGB',
              meta: {},
              parentId: 'HD4krtKa',
              role: 'assistant',
              topicId: 'jvfmUEwF',
              updateAt: 1_693_114_820_418,
            },
            QaAUgIGC: {
              content: '3',
              createAt: 1_693_043_755_942,
              id: 'QaAUgIGC',
              meta: {},
              role: 'user',
              topicId: 'jvfmUEwF',
              updateAt: 1_693_114_820_428,
            },
            jF4p75eF: {
              content: '4',
              createAt: 1_693_043_755_952,
              extra: { fromModel: 'gpt-3.5-turbo' },
              id: 'jF4p75eF',
              meta: {},
              parentId: 'QaAUgIGC',
              role: 'assistant',
              topicId: 'jvfmUEwF',
              updateAt: 1_693_114_820_439,
            },
          },
          config: {} as V1Config,
          createAt: 12,
          id: 'inbox',
          meta: {},
          topics: {
            IVfDVB5g: {
              createAt: 1_693_228_301_335,
              id: 'IVfDVB5g',
              title: '上游服务端错误状态码\n下游服务器错误状态码',
              updateAt: 1_693_228_303_288,
            },
            jvfmUEwF: {
              createAt: 1_693_114_820_394,
              id: 'jvfmUEwF',
              title: 'JSX错误：children属性类型错误',
              updateAt: 1_693_114_821_388,
            },
          },
          type: 'agent',
          updateAt: 12,
        },
      },
      version: 1,
    };

    const migratedData = versionController.migrate(data);

    expect(migratedData.version).toEqual(2);
    expect(migratedData.state.messages).toEqual([
      {
        content: '1',
        createdAt: 1_692_891_912_689,
        id: 'HD4krtKa',
        meta: {},
        role: 'user',
        sessionId: 'inbox',
        topicId: 'jvfmUEwF',
        updatedAt: 1_693_114_820_406,
      },
      {
        content: '2',
        createdAt: 1_692_891_912_699,
        fromModel: 'gpt-3.5-turbo',
        id: 'K4AVcvGB',
        meta: {},
        parentId: 'HD4krtKa',
        role: 'assistant',
        sessionId: 'inbox',
        topicId: 'jvfmUEwF',
        updatedAt: 1_693_114_820_418,
      },
      {
        content: '3',
        createdAt: 1_693_043_755_942,
        id: 'QaAUgIGC',
        meta: {},
        role: 'user',
        sessionId: 'inbox',
        topicId: 'jvfmUEwF',
        updatedAt: 1_693_114_820_428,
      },
      {
        content: '4',
        createdAt: 1_693_043_755_952,
        fromModel: 'gpt-3.5-turbo',
        id: 'jF4p75eF',
        meta: {},
        parentId: 'QaAUgIGC',
        role: 'assistant',
        sessionId: 'inbox',
        topicId: 'jvfmUEwF',
        updatedAt: 1_693_114_820_439,
      },
    ]);
    expect(migratedData.state.topics).toEqual([
      {
        createdAt: 1_693_228_301_335,
        id: 'IVfDVB5g',
        sessionId: 'inbox',
        title: '上游服务端错误状态码\n下游服务器错误状态码',
        updatedAt: 1_693_228_303_288,
      },
      {
        createdAt: 1_693_114_820_394,
        id: 'jvfmUEwF',
        sessionId: 'inbox',
        title: 'JSX错误：children属性类型错误',
        updatedAt: 1_693_114_821_388,
      },
    ]);
  });
});
