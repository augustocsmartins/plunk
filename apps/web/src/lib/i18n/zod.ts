import {z, ZodIssueCode} from 'zod';

/**
 * Brazilian Portuguese messages for zod's built-in validation errors, used by every form.
 * Messages written in a schema (`.min(1, 'Enter your current password')`) are left as they are
 * and translated where they are shown (FormMessage).
 */
export const ptBRZodErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return {message: 'Campo obrigatório'};
      return {message: 'Valor inválido'};
    case ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return {message: 'E-mail inválido'};
      if (issue.validation === 'url') return {message: 'URL inválida'};
      if (issue.validation === 'uuid') return {message: 'Identificador inválido'};
      return {message: 'Formato inválido'};
    case ZodIssueCode.too_small:
      if (issue.type === 'string') {
        return {
          message: Number(issue.minimum) <= 1 ? 'Campo obrigatório' : `Deve ter pelo menos ${issue.minimum} caracteres`,
        };
      }
      if (issue.type === 'array') return {message: `Selecione pelo menos ${issue.minimum} item(ns)`};
      if (issue.type === 'number') return {message: `Deve ser no mínimo ${issue.minimum}`};
      return {message: ctx.defaultError};
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return {message: `Deve ter no máximo ${issue.maximum} caracteres`};
      if (issue.type === 'array') return {message: `Selecione no máximo ${issue.maximum} item(ns)`};
      if (issue.type === 'number') return {message: `Deve ser no máximo ${issue.maximum}`};
      return {message: ctx.defaultError};
    case ZodIssueCode.invalid_enum_value:
      return {message: 'Opção inválida'};
    case ZodIssueCode.invalid_date:
      return {message: 'Data inválida'};
    default:
      return {message: ctx.defaultError};
  }
};
