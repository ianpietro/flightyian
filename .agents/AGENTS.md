# Regras do Projeto (Flighty IAN)

- **Sincronização com o GitHub**: Sempre que houver integração com Git/GitHub e acesso ao repositório remoto, todas as alterações, correções e novos recursos implementados devem ser obrigatoriamente commitados e enviados para o repositório remoto (`git push`) de forma automática ao término de cada tarefa ou ciclo de alteração, garantindo a sincronização imediata sem depender de solicitação manual do usuário.
- **Deploy e Confirmação no Vercel**: Para assegurar que o deploy em produção de fato ocorra (e mitigar falhas/atrasos nas triggers automáticas de integração do GitHub com o Vercel), o agente deve obrigatoriamente rodar um deploy manual via linha de comando utilizando `npx vercel --prod --yes` ao término de cada alteração relevante, validando o status de publicação do projeto.

