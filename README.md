# Empresas Sem Site 2.2

Extensão Chrome/Edge Manifest V3 para pesquisar leads, organizar o funil e preparar mensagens de contato. A pasta `empresas-sem-site-v2` contém a extensão completa, com `manifest.json` na raiz. Não há instalação de dependências para usá-la. Os dados ficam em `chrome.storage.local` no navegador e nenhuma mensagem é enviada automaticamente.

## Instalar ou atualizar

1. Abra `chrome://extensions/` ou `edge://extensions/` e ative o **Modo do desenvolvedor**.
2. Clique em **Carregar sem compactação** e selecione a pasta `empresas-sem-site-v2`.
3. Se ela já estiver carregada, clique em **Recarregar** no cartão da extensão. Desative versões duplicadas para evitar confundir os resultados.

Abra o popup da extensão e clique em **Abrir dashboard completa**. A mesma tela está disponível em **Detalhes → Opções da extensão**. O dashboard reúne pesquisa por fonte, indicadores do funil, filtros, tabela paginada, painel do lead, playbook de mensagens e configurações.

Para compartilhar ou enviar para publicação, compacte **o conteúdo desta pasta** em um ZIP, deixando `manifest.json` na raiz do arquivo compactado. Para instalar manualmente pelo modo de desenvolvedor, use a pasta descompactada.

## Pesquisa e importação

- **Google Maps:** informe segmento e cidade. A coleta automática abre o Maps e lê os resultados quando o navegador permite scripts da extensão. Se a política `ExtensionSettings` impedir a injeção, use **Importar ou cadastrar lead sem script na página** para importar CSV/JSON ou adicionar um lead manualmente. O arquivo precisa ter uma coluna `Nome` ou `Empresa`; colunas como `Telefone`, `Site`, `Instagram`, `Endereço`, `Link Google Maps`, `Mensagem` e `Status da mensagem` são aproveitadas. A extensão não consegue remover uma política imposta pelo navegador.
- **OpenStreetMap:** abra o mapa, posicione a região e clique em **Usar centro da aba OSM**. Informe o segmento e o raio de 500 a 10.000 m. A pesquisa consulta o Overpass; a cobertura depende dos dados cadastrados no OSM. Dados © colaboradores do OpenStreetMap, ODbL: https://www.openstreetmap.org/copyright. Overpass: https://wiki.openstreetmap.org/wiki/Overpass_API.
- **EmpresAqui:** importe um CSV/JSON exportado da plataforma ou consulte um CNPJ com o token do seu plano. O token é usado na requisição e não é salvo. A API documentada oferece consulta por CNPJ; pesquisa de listas depende da exportação disponível na conta: https://www.empresaqui.com.br/docs.

## Funil e mensagens

Filtre por fonte, etapa, oportunidade, status da mensagem ou texto. Edite a etapa, confirme a classificação do site e registre observações e próximo contato. O score prioriza os leads por sinais presentes no cadastro; ele não prevê vendas. Leads repetidos são unidos por identificador, CNPJ ou dados de contato, preservando o andamento comercial.

Em **Mensagens personalizadas**, configure sua empresa, nome, oferta, convite e modelos de texto. Cada card pode gerar uma mensagem contextual, receber edição manual, copiar o texto e abrir o WhatsApp para **envio manual**. O modelo de **prévia pronta** exige um link informado. Marque `Contatada` ou `Respondida` após a ação real. CSV e JSON exportam os leads filtrados com campos do funil e mensagens; o CSV neutraliza fórmulas de planilha.

No dashboard, **Configurações → Backup para a equipe** exporta e importa leads, mensagens e modelos em JSON. A importação mescla leads repetidos, preservando o andamento já registrado no navegador. Os dados não são sincronizados automaticamente entre colaboradores: cada pessoa importa o backup no próprio navegador e pode ajustar seu nome nas configurações.

As indicações **Sem site informado**, **Só WhatsApp** e **Só redes sociais** descrevem o campo informado pela fonte consultada. Confirme os dados antes de abordar a empresa. **Site quebrado (confirmado)** deve ser marcado após verificação manual.

## Política do Google Maps

Se aparecer `This page cannot be scripted due to an ExtensionsSettings policy`, confira `ExtensionSettings` em `chrome://policy` ou `edge://policy`. Um administrador do navegador pode ter definido `runtime_blocked_hosts` ou `runtime_allowed_hosts`. Recarregar a extensão ou mudar o `manifest.json` não anula essa política. Use a importação/cadastro manual ou as outras fontes enquanto o acesso ao Maps estiver bloqueado. Referência: https://support.google.com/chrome/a/answer/7532015.

## Desenvolvimento

Execute `npm run check` para verificar sintaxe e testes locais. `npm run smoke` abre o dashboard no Chrome com dados simulados e confere navegação, edição de lead, mensagem e layout móvel. Também valide as fontes no navegador usado pela equipe: a interface do Maps e a disponibilidade dos serviços externos podem mudar.

