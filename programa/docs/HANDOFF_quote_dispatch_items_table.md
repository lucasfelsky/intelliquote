# Handoff: tabela de itens do e-mail de dispatch (`quote_dispatch`)

## Contexto

O Jodit (editor do template no modo visual da tela de Templates) remove/mangleia
atributos e estilos do `<thead>` e do `<colgroup>` da tabela de itens ao salvar,
o que faz a tabela sair desalinhada no e-mail enviado ao fornecedor. A correção
moveu a tabela INTEIRA (colgroup + thead + tbody) pro código, exposta como um
novo marcador único `{{itemsTable}}`. Nada muda no banco automaticamente — este
documento é o roteiro pra você aplicar a edição manual no template `quote_dispatch`.

## O que fazer

1. Abra a tela de Templates, edite o template `quote_dispatch` (locale `en`).
2. Troque para o modo **"texto puro"/source** do editor (Jodit apaga
   comentários HTML e atributos quando você edita em modo visual — não edite
   visualmente este bloco).
3. Localize o bloco abaixo (é a tabela de 5 colunas — PRODUCT/QTY/INCOTERM/
   ORIGIN/DESTINATION — que hoje usa `{{itemsRows}}` no `<tbody>`).

## REMOVER (bloco atual, verbatim de `dump-template-out.txt` linhas 24-40)

```html
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;table-layout:fixed;mso-table-lspace:0pt;mso-table-rspace:0pt;">
              <colgroup>
                <col style="width:32%;" />
                <col style="width:14%;" />
                <col style="width:14%;" />
                <col style="width:18%;" />
                <col style="width:22%;" />
              </colgroup>
              <thead><tr style="background:#F8FBFA;">
                <th align="left" style="padding:12px 14px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:700;font-size:12px;">PRODUCT</th>
                <th align="right" style="padding:12px 14px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:700;font-size:12px;">QTY</th>
                <th align="left" style="padding:12px 14px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:700;font-size:12px;">INCOTERM</th>
                <th align="left" style="padding:12px 14px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:700;font-size:12px;">ORIGIN</th>
                <th align="left" style="padding:12px 14px;border-bottom:1px solid #DCE9E5;color:#4A5560;font-weight:700;font-size:12px;">DESTINATION</th>
              </tr></thead>
              <tbody>{{itemsRows}}</tbody>
            </table>
```

## COLOCAR no lugar (uma linha, sozinha)

```html
            {{itemsTable}}
```

Isso é tudo — o marcador `{{itemsTable}}` já gera a tabela completa
(colgroup + thead com os 5 rótulos + tbody com as linhas dos itens), com
estilos inline em cada `<th>`/`<td>` (bulletproof, sem depender do editor
preservar `<colgroup>`/`<thead>`).

## Observações

- Se houver, em algum outro trecho do template atualmente em produção (fora
  das linhas 24-40 do dump usado como referência), um rótulo/título separado
  do tipo "ITEMS" acima da tabela (como existe no `.html` de fallback,
  `src/mailer/templates/quote-dispatch.en.html`, linhas 76-77), **mantenha
  esse rótulo onde está** — ele não faz parte do bloco a remover/substituir,
  só a tabela em si é trocada por `{{itemsTable}}`.
- `{{itemsRows}}` continua funcionando no código (compat) — não é obrigatório
  remover outros usos dele em outros templates (`quote_reply`, `quote_po`),
  que estão fora do escopo desta mudança.
- Nenhuma credencial ou dado de produção está envolvido neste documento — é
  só o texto do template a ser editado por você na tela de Templates.
