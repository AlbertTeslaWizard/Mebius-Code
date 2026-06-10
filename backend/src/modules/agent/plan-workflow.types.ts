export interface PlanQuestionChoice {
  id: string;
  label: string;
  description?: string;
  notes?: string;
}

export interface PlanQuestion {
  id: string;
  title: string;
  prompt: string;
  choices: PlanQuestionChoice[];
  recommendedChoiceId?: string;
  allowCustomAnswer: boolean;
  notes?: string;
  required?: boolean;
  multiSelect?: boolean;
}

export interface PlanQuestionAnswer {
  questionId: string;
  choiceId?: string;
  choiceIds?: string[];
  customAnswer?: string;
  notes?: string;
}
