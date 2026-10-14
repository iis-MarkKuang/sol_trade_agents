export type DecisionProviderName = 'none' | 'jev';

export type DecisionQuestion =
  | {
      type: 'choice';
      instructions: string;
      criteria: Record<string, string>;
    }
  | {
      type: 'score';
      instructions: string;
      criteria: string[];
    }
  | {
      type: 'noul';
      instructions: string;
    };

export interface DecisionRequest {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
}

export type DecisionAnswer =
  | {
      type: 'choice';
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | {
      type: 'score';
      score: number;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | {
      type: 'noul';
      noul: number;
    };

export interface DecisionResult {
  provider: Exclude<DecisionProviderName, 'none'>;
  model: string;
  answers: Record<string, DecisionAnswer>;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface DecisionAdapter {
  readonly name: Exclude<DecisionProviderName, 'none'>;
  isConfigured(): boolean;
  evaluate(request: DecisionRequest): Promise<DecisionResult>;
}
