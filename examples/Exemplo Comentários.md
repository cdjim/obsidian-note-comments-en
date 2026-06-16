# Relatório de Análise de Logs

Este documento de exemplo serve para testar o plugin de comentários. Ele contém cabeçalhos, parágrafos, imagens, listas, tabelas e blocos de código — incluindo comentários pendentes e concluídos.

## Contexto

A redução de ruído operacional é essencial para a eficiência do SOC. Eventos de logon do tipo 3 geram volume excessivo e devem ser filtrados na origem sempre que possível.

![Diagrama de arquitetura](https://example.com/diagrama.png)

## Metodologia

Foram analisados os logs do período das 18h às 22h. A consulta abaixo foi utilizada para validar a redução observada:

```spl
index="assai_fortigate" sourcetype=fortigate_traffic
| timechart span=15m count
```

## Resultados

Os resultados mostraram uma redução de 62% no volume de eventos após a aplicação do filtro. A tabela a seguir resume os números coletados:

| Período | Antes | Depois |
| --- | --- | --- |
| 18h-19h | 12000 | 4600 |
| 19h-20h | 11500 | 4300 |

> Observação: os valores são aproximados e podem variar conforme o ambiente analisado.

## Conclusão

A estratégia de filtragem na origem mostrou-se eficaz e deve ser estendida aos demais índices monitorados.
