# Empresas Sem Site 2.0

Extensão Chrome/Edge Manifest V3 para pesquisar oportunidades e acompanhar um funil local. Os leads ficam em `chrome.storage.local`; fechar o popup não apaga a pesquisa. Nenhum contato é enviado automaticamente.

## Instalação

1. Abra `chrome://extensions/` ou `edge://extensions/` e ative o modo desenvolvedor.
2. Clique em **Carregar sem compactação** e selecione esta pasta `empresas-sem-site-v2`.
3. Se outra versão estiver instalada, desative-a para evitar confusão entre os resultados.

## Fontes

- **Google Maps:** informe segmento e cidade. A extensão abre a pesquisa em uma aba e percorre os cards visíveis. Mudanças na interface do Maps podem exigir ajuste dos seletores. Se aparecer consentimento ou CAPTCHA, resolva manualmente e reinicie a busca. O campo "site a verificar" indica apenas que há um URL informado; após verificar por conta própria, você pode marcar "site quebrado (confirmado)" no card.
- **OpenStreetMap:** abra `https://www.openstreetmap.org/`, encontre a região e ajuste o mapa. Com a aba ativa, abra a extensão, escolha OpenStreetMap e clique em **Usar centro da aba OSM**. Informe o segmento e o raio (500 a 10.000 m). Categorias comuns em português são mapeadas para etiquetas OSM; outros termos buscam nomes de estabelecimentos. A consulta usa uma chamada ao Overpass por pesquisa, até 500 elementos retornados, com outro servidor se o primeiro falhar. A cobertura depende do cadastro voluntário do OSM. Dados © OpenStreetMap contributors, ODbL: https://www.openstreetmap.org/copyright. Uso do Overpass: https://wiki.openstreetmap.org/wiki/Overpass_API.
- **EmpresAqui:** exporte uma lista autorizada em CSV ou JSON na plataforma e importe o arquivo na extensão. Ela aceita cabeçalhos comuns como `Nome Fantasia`, `CNPJ`, `Telefone`, `Site`, `Email` e `Endereço`. Quando o arquivo não contém uma coluna de site, o lead aparece como **Dados incompletos**. Também é possível consultar um CNPJ individual com o token da sua conta; ele não é salvo na extensão. A API documentada é de consulta por CNPJ, não de pesquisa de listas por filtros: https://www.empresaqui.com.br/docs. A disponibilidade da API e exportação depende do plano da conta.

## Funil e exportação

Filtre por fonte, etapa, oportunidade e texto. Cada lead tem pontuação de 0 a 100, calculada por oportunidade (10–75 pontos), telefone (+20), email (+10) e endereço (+5). O score é uma regra simples de priorização, não uma previsão de venda. Edite a etapa, classifique a oportunidade após revisão e salve observações; a deduplicação por fonte, CNPJ, nome/telefone ou nome/endereço conserva esses campos. CSV e JSON exportam os leads filtrados; o CSV neutraliza valores que poderiam virar fórmulas em planilhas e inclui atribuição OSM.

As categorias **Sem site informado**, **Só WhatsApp** e **Só redes sociais** descrevem o campo de site da fonte, não uma verificação de toda a presença digital da empresa. Revise os dados antes de abordar um lead.

## Desenvolvimento

`npm run check` verifica sintaxe e os testes do núcleo. Teste também em um navegador com a extensão carregada, pois a estrutura do Google Maps muda e serviços externos podem limitar consultas.
