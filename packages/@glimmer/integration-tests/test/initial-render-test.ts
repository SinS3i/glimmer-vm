import { Dict, Option } from '@glimmer/interfaces';
import { SafeString } from '@glimmer/runtime';
import {
  OPEN,
  EMPTY,
  CLOSE,
  equalTokens,
  InitialRenderSuite,
  suite,
  jitSuite,
  toTextContent,
  RehydrationDelegate,
  toInnerHTML,
  firstElementChild,
  GLIMMER_TEST_COMPONENT,
  test,
  Content,
  content,
  strip,
  blockStack,
  ComponentBlueprint,
  assertEmberishElement,
  assertSerializedInElement,
  replaceHTML,
  assertElement,
  assertElementShape,
  componentSuite,
} from '@glimmer/integration-tests';
import { expect } from '@glimmer/util';
import { SimpleElement } from '@simple-dom/interface';

class RenderTests extends InitialRenderSuite {
  static suiteName = 'initial render (client)';
  name = 'client';
}

class AbstractRehydrationTests extends InitialRenderSuite {
  name = 'rehydration';
  protected delegate!: RehydrationDelegate;
  protected serverOutput!: Option<string>;

  renderServerSide(
    template: string | ComponentBlueprint,
    context: Dict<unknown>,
    element: SimpleElement | undefined = undefined
  ): void {
    this.serverOutput = this.delegate.renderServerSide(
      template as string,
      context,
      () => this.takeSnapshot(),
      element
    );
    replaceHTML(this.element, this.serverOutput);
  }

  renderClientSide(template: string | ComponentBlueprint, context: Dict<unknown>): void {
    this.context = context;
    this.renderResult = this.delegate.renderClientSide(template as string, context, this.element);
  }

  assertRehydrationStats({ nodesRemoved: nodes }: { nodesRemoved: number }) {
    let { clearedNodes } = this.delegate.rehydrationStats;
    this.assert.equal(clearedNodes.length, nodes, 'cleared nodes');
  }

  assertExactServerOutput(_expected: string) {
    let output = expect(
      this.serverOutput,
      'must renderServerSide before calling assertServerOutput'
    );
    equalTokens(output, _expected);
  }

  assertServerOutput(..._expected: Content[]) {
    this.assertExactServerOutput(content([OPEN, ..._expected, CLOSE]));
  }
}

class Rehydration extends AbstractRehydrationTests {
  static suiteName = 'rehydration';

  @test
  'rehydrates into element with pre-existing content'() {
    let rootElement = this.delegate.serverDoc.createElement('div');
    let extraContent = this.delegate.serverDoc.createElement('noscript');
    rootElement.appendChild(extraContent);

    let noScriptString = '<noscript></noscript>';
    let template = '<div>Hi!</div>';
    this.renderServerSide(template, {}, rootElement);
    this.assertExactServerOutput(content([noScriptString, OPEN, ...template, CLOSE]));
    this.renderClientSide(template, {});
    this.assertHTML('<noscript></noscript><div>Hi!</div>');
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertStableNodes();
  }

  @test
  'handles non-empty trusted content (triple-curlies)'() {
    let template = '<div>{{{value}}}</div>';
    let obj: { value: string } = { value: 'foo' };
    this.renderServerSide(template, obj);
    this.renderClientSide(template, obj);
    this.assertHTML('<div>foo</div>');
  }

  @test
  'handles empty trusted content (triple-curlies)'() {
    let template = '<div>{{{value}}}</div>';
    let obj: { value: string } = { value: '' };
    this.renderServerSide(template, obj);
    this.renderClientSide(template, obj);
    this.assertHTML('<div></div>');
  }

  @test
  'handles empty trusted content (html safe string)'() {
    let template = '<div>{{value}}</div>';

    let safeString: SafeString = {
      toHTML() {
        return '';
      },
    };
    let obj = { value: safeString };

    this.renderServerSide(template, obj);
    this.renderClientSide(template, obj);
    this.assertHTML('<div></div>');
  }

  @test
  'table with omitted tbody'() {
    let template = '<table><tr><td>standards</td></tr></table>';
    this.renderServerSide(template, {});
    this.assertServerOutput('<table><tbody><tr><td>standards</td></tr></tbody></table>');
    this.renderClientSide(template, {});
    this.assertHTML('<table><tbody><tr><td>standards</td></tr></tbody></table>');
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertStableNodes();
  }

  @test
  'mismatched text nodes'() {
    let template = '{{content}}';
    this.renderServerSide(template, { content: 'hello' });
    this.assertServerOutput(OPEN, 'hello', CLOSE);

    this.renderClientSide(template, { content: 'goodbye' });
    this.assertHTML('goodbye');
    // Just repairs the value of the text node
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertStableRerender();
  }

  @test
  'mismatched text nodes (server-render empty)'() {
    let template = '{{content}} world';
    this.renderServerSide(template, { content: '' });
    this.assertServerOutput(OPEN, EMPTY, CLOSE, ' world');

    this.renderClientSide(template, { content: 'hello' });
    this.assertHTML('hello world');
    // Just repairs the value of the text node
    this.assertRehydrationStats({ nodesRemoved: 0 });

    // TODO: handle % % in the testing DSL
    // this.assertStableNodes();
    this.assertStableRerender();
  }

  @test
  'mismatched elements'() {
    let template = '{{#if admin}}<div>hi admin</div>{{else}}<p>HAXOR</p>{{/if}}';
    this.renderServerSide(template, { admin: true });
    this.assertServerOutput(OPEN, '<div>hi admin</div>', CLOSE);

    this.renderClientSide(template, { admin: false });
    this.assertRehydrationStats({ nodesRemoved: 1 });
    this.assertHTML('<p>HAXOR</p>');
    this.assertStableRerender();
  }

  @test
  'extra nodes at the end'() {
    let template = '{{#if admin}}<div>hi admin</div>{{else}}<div>HAXOR{{stopHaxing}}</div>{{/if}}';
    this.renderServerSide(template, { admin: false, stopHaxing: 'stahp' });
    this.assertServerOutput(OPEN, '<div>HAXOR', OPEN, 'stahp', CLOSE, '</div>', CLOSE);

    this.renderClientSide(template, { admin: true });
    this.assertRehydrationStats({ nodesRemoved: 1 });
    this.assertHTML('<div>hi admin</div>');
    this.assertStableRerender();
  }

  @test
  'Node curlies'() {
    let template = '<div>{{node}}</div>';

    let doc = this.delegate.serverDoc;
    let node = doc.createTextNode('hello');
    this.renderServerSide(template, { node });
    this.assertServerOutput('<div>', OPEN, 'hello', CLOSE, '</div>');
    doc = this.delegate.clientDoc;
    let clientNode = doc.createTextNode('hello');
    this.context = { node: clientNode };
    this.renderClientSide(template, { node: clientNode });
    this.assertHTML('<div>hello</div>', 'first clean rerender');
    // Just repairs the value of the text node
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertStableRerender();

    let clientNode2 = doc.createTextNode('goodbye');
    this.rerender({ node: clientNode2 });
    this.assertHTML('<div>goodbye</div>', 'rerender after node update');
    this.assertStableNodes({ except: clientNode });

    this.rerender({ node: clientNode });
    this.assertHTML('<div>hello</div>', 'back to the beginning');
    this.assertStableNodes({ except: clientNode2 });
  }

  @test
  'in-element can rehydrate'() {
    let template = '<outer>{{#in-element remote}}<inner>Wat Wat</inner>{{/in-element}}</outer>';
    let doc = this.delegate.serverDoc;
    let remote = doc.createElement('remote');

    this.renderServerSide(template, { remote });
    let serializedRemote = this.delegate.serialize(remote);
    let b = blockStack();
    assertSerializedInElement(
      serializedRemote,
      strip`
      ${b(2)}
      <inner>Wat Wat</inner>
      ${b(2)}
    `
    );

    doc = this.delegate.clientDoc;
    let clientRemote = (remote = doc.createElement('remote'));
    let host = doc.createElement('div');
    host.appendChild(this.element);
    host.appendChild(clientRemote);
    replaceHTML(clientRemote, serializedRemote);
    this.element = assertElement(host.firstChild);

    this.renderClientSide(template, { remote: clientRemote });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assert.equal(toInnerHTML(clientRemote), '<inner>Wat Wat</inner>');
  }

  @test
  'nested in-element can rehydrate'() {
    let template = strip`
    <outer>
      {{#in-element remoteParent}}
        <inner>{{#in-element remoteChild}}Wat Wat{{/in-element}}</inner>
      {{/in-element}}
    </outer>
    `;
    let doc = this.delegate.serverDoc;
    let remoteParent = doc.createElement('remote');
    let remoteChild = doc.createElement('other');

    this.renderServerSide(template, { remoteParent, remoteChild });
    let serializedParentRemote = this.delegate.serialize(remoteParent);
    let serializedRemoteChild = this.delegate.serialize(remoteChild);
    let b = blockStack();
    assertSerializedInElement(
      serializedParentRemote,
      strip`
      ${b(2)}
        <inner>
          ${b(3)}<!---->${b(3)}
        </inner>
      ${b(2)}
    `,
      'Serialized parent remote'
    );
    assertSerializedInElement(
      serializedRemoteChild,
      strip`
      ${b(4)}Wat Wat${b(4)}
    `,
      'Serilaized nested remote'
    );
    doc = this.delegate.clientDoc;
    let clientRemoteParent = doc.createElement('remote');
    let clientRemoteChild = doc.createElement('other');
    let host = doc.createElement('div');
    host.appendChild(this.element);
    host.appendChild(clientRemoteParent);
    host.appendChild(clientRemoteChild);

    replaceHTML(clientRemoteParent, serializedParentRemote);
    replaceHTML(clientRemoteChild, serializedRemoteChild);
    this.element = assertElement(host.firstChild);
    this.renderClientSide(template, {
      remoteParent: clientRemoteParent,
      remoteChild: clientRemoteChild,
    });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assert.equal(toInnerHTML(clientRemoteParent), '<inner><!----></inner>');
    this.assert.equal(toInnerHTML(clientRemoteChild), 'Wat Wat');
  }

  @test
  'svg elements'() {
    let template = '<svg>{{#if isTrue}}<circle />{{/if}}</svg><p>Hello</p>';
    this.renderServerSide(template, { isTrue: true });
    let b = blockStack();
    this.assertHTML(strip`
      ${b(0)}
      <svg>
        ${b(1)}
        <circle />
        ${b(1)}
      </svg>
      <p>Hello</p>
      ${b(0)}
    `);
    this.renderClientSide(template, { isTrue: true });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertHTML(strip`
      <svg>
      <circle />
      </svg>
      <p>Hello</p>
    `);
    this.assertStableRerender();
  }

  @test
  'clearing bounds'() {
    let template = strip`
      {{#if isTrue}}
        {{#each items key="id" as |item i|}}
          <p>{{item}}-{{i}}</p>
        {{/each}}
      {{/if}}
    `;
    this.renderServerSide(template, { isTrue: true, items: [1, 2] });
    let b = blockStack();
    this.assertHTML(strip`
      ${b(0)}
      ${b(1)}
      ${b(2)}
      ${b(3)}
      ${b(4)}
      <p>
        ${b(5)}
        1
        ${b(5)}
        -
        ${b(5)}
        0
        ${b(5)}
      </p>
      ${b(4)}
      ${b(4)}
      <p>
        ${b(5)}
        2
        ${b(5)}
        -
        ${b(5)}
        1
        ${b(5)}
      </p>
      ${b(4)}
      ${b(3)}
      ${b(2)}
      ${b(1)}
      ${b(0)}
    `);

    this.renderClientSide(template, { isTrue: false, items: [3, 4] });
    // Removes the block and each <p>
    this.assertRehydrationStats({ nodesRemoved: 2 });
    this.assertHTML('<!---->');
    this.assertStableRerender();
  }

  @test
  'top-level clearing bounds'() {
    let template = strip`
      <top>
      {{#if isTrue}}
        <inside>
        {{#each items key="id" as |item i|}}
          <p>{{item}}-{{i}}</p>
        {{/each}}
        </inside>
      {{/if}}
      </top>
      {{#if isFalse}}
        {{#each items key="id" as |item i|}}
          <p>{{item}}-{{i}}</p>
        {{/each}}
      {{/if}}
    `;
    this.renderServerSide(template, { isTrue: true, items: [1, 2], isFalse: false });
    let b = blockStack();
    this.assertHTML(strip`
      ${b(0)}
      <top>
        ${b(1)}
        <inside>
          ${b(2)}
          ${b(3)}
          ${b(4)}
          <p>
            ${b(5)}
            1
            ${b(5)}
            -
            ${b(5)}
            0
            ${b(5)}
          </p>
          ${b(4)}
          ${b(4)}
          <p>
            ${b(5)}
            2
            ${b(5)}
            -
            ${b(5)}
            1
            ${b(5)}
          </p>
          ${b(4)}
          ${b(3)}
          ${b(2)}
        </inside>
        ${b(1)}
      </top>
      ${b(1)}
      <!---->
      ${b(1)}
      ${b(0)}
    `);

    this.renderClientSide(template, { isTrue: false, items: [3, 4], isFalse: true });
    // Clears block markers for both and removes `inside`
    this.assertRehydrationStats({ nodesRemoved: 1 });
    this.assertHTML('<top><!----></top><p>3-0</p><p>4-1</p>');
    this.assertStableRerender();
  }

  @test
  '#each rehydration'() {
    let template = "{{#each items key='id' as |item|}}<p>{{item}}</p>{{/each}}";
    this.renderServerSide(template, { items: [1, 2, 3] });
    let b = blockStack();
    this.assertHTML(strip`
      ${b(0)}
      ${b(1)}
      ${b(2)}
      ${b(3)}
      <p>
        ${b(4)}
        1
        ${b(4)}
      </p>
      ${b(3)}
      ${b(3)}
      <p>
        ${b(4)}
        2
        ${b(4)}
      </p>
      ${b(3)}
      ${b(3)}
      <p>
        ${b(4)}
        3
        ${b(4)}
      </p>
      ${b(3)}
      ${b(2)}
      ${b(1)}
      ${b(0)}
    `);

    this.renderClientSide(template, { items: [1, 2, 4] });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertHTML(strip`
      <p>1</p>
      <p>2</p>
      <p>4</p>
    `);
    this.assertStableRerender();
  }
}

class RehydratingComponents extends AbstractRehydrationTests {
  _buildComponent(blueprint: ComponentBlueprint, properties: Dict<unknown> = {}) {
    let template = this.buildComponent(blueprint);
    if (this.testType === 'Dynamic' && properties['componentName'] === undefined) {
      properties['componentName'] = blueprint.name || GLIMMER_TEST_COMPONENT;
    }
    return template;
  }

  assertServerComponent(html: string, attrs: Object = {}) {
    // the Dynamic test type is using {{component 'foo'}} style invocation
    // and therefore an extra node is added delineating the block start
    let elementIndex = this.testType === 'Dynamic' ? 3 : 2;
    let element = assertElement(this.element.childNodes[elementIndex]);

    if (this.testType === 'Glimmer') {
      assertElementShape(element, 'div', attrs, html);
    } else {
      assertEmberishElement(element, 'div', attrs, html);
    }
  }

  renderServerSide(blueprint: ComponentBlueprint, properties: Dict<unknown> = {}) {
    let template = this._buildComponent(blueprint, properties);
    super.renderServerSide(template, properties);
  }

  renderClientSide(blueprint: ComponentBlueprint, properties: Dict<unknown> = {}) {
    let template = this._buildComponent(blueprint, properties);
    super.renderClientSide(template, properties);
  }

  @test
  'Component invocations'() {
    let layout = 'Hello {{@name}}';
    let args = { name: 'name' };
    this.renderServerSide(
      {
        layout,
        args,
      },
      { name: 'Filewatcher' }
    );
    let b = blockStack();
    let id = this.testType === 'Dynamic' ? 3 : 2;
    this.assertServerComponent(`Hello ${b(id)}Filewatcher${b(id)}`);

    this.renderClientSide(
      {
        layout,
        args,
      },
      { name: 'Filewatcher' }
    );
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello Filewatcher');
    this.assertStableRerender();
  }

  @test
  'Mismatched Component invocations'() {
    let layout = 'Hello {{@name}}';
    let args = { name: 'name' };
    this.renderServerSide(
      {
        layout,
        args,
      },
      { name: 'Filewatcher' }
    );
    let b = blockStack();
    let id = this.testType === 'Dynamic' ? 3 : 2;
    this.assertServerComponent(`Hello ${b(id)}Filewatcher${b(id)}`);

    this.renderClientSide(
      {
        layout,
        args,
      },
      { name: 'Chad' }
    );
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello Chad');
    this.assertStableRerender();
  }

  @test
  'Component invocations with block params'() {
    let layout = 'Hello {{yield @name}}';
    let template = '{{name}}';
    let blockParams = ['name'];
    let args = { name: 'name' };

    this.renderServerSide(
      {
        layout,
        template,
        args,
        blockParams,
      },
      { name: 'Filewatcher' }
    );
    let b = blockStack();
    let id = this.testType === 'Dynamic' ? 3 : 2;
    this.assertServerComponent(`Hello ${b(id)}Filewatcher${b(id)}`);

    this.renderClientSide(
      {
        layout,
        template,
        args,
        blockParams,
      },
      { name: 'Filewatcher' }
    );
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello Filewatcher');
    this.assertStableRerender();
  }

  @test
  'Mismatched Component invocations with block params'() {
    let layout = 'Hello {{yield @name}}';
    let template = '{{name}}';
    let blockParams = ['name'];
    let args = { name: 'name' };

    this.renderServerSide(
      {
        layout,
        template,
        args,
        blockParams,
      },
      { name: 'Filewatcher' }
    );
    let b = blockStack();
    let id = this.testType === 'Dynamic' ? 3 : 2;
    this.assertServerComponent(`Hello ${b(id)}Filewatcher${b(id)}`);

    this.renderClientSide(
      {
        layout,
        template,
        args,
        blockParams,
      },
      { name: 'Chad' }
    );
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello Chad');
    this.assertStableRerender();
  }

  @test
  'Component invocations with template'() {
    let layout = 'Hello {{yield}}';
    let template = 'Filewatcher';
    this.renderServerSide(
      {
        layout,
        template,
      },
      { name: 'Filewatcher' }
    );
    this.assertServerComponent(`Hello <!--%|%-->Filewatcher`);

    this.renderClientSide({
      layout,
      template,
    });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello Filewatcher');
    this.assertStableRerender();
  }

  @test
  'Mismatched Component invocations with template'() {
    let layout = 'Hello {{yield}}';
    let template = 'Filewatcher';
    this.renderServerSide({
      layout,
      template,
    });
    this.assertServerComponent(`Hello <!--%|%-->Filewatcher`);

    this.renderClientSide({
      layout,
      template: 'Chad',
    });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello Chad');
    this.assertStableRerender();
  }

  @test
  'Component invocations with empty args'() {
    let layout = 'Hello {{@foo}}';
    this.renderServerSide({
      layout,
    });
    let b = blockStack();
    let id = this.testType === 'Dynamic' ? 3 : 2;
    this.assertServerComponent(`Hello ${b(id)}<!--% %-->${b(id)}`);

    this.renderClientSide({
      layout,
    });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertComponent('Hello ');
    this.assertStableRerender();
  }

  @test
  'Multiple invocations'() {
    let name;
    let template;

    let emberishComponent = false;
    if (this.testType === 'Dynamic' || this.testType === 'Curly') {
      name = 'foo-bar';
      template = '{{#foo-bar}}World{{/foo-bar}}';
      emberishComponent = true;
    } else {
      name = 'FooBar';
      template = '<FooBar>World</FooBar>';
    }

    this.registerComponent(this.testType, name, 'Hello {{yield}}');
    let layout = `{{yield}}`;
    this.renderServerSide({
      layout,
      template,
    });
    let b = blockStack();
    if (emberishComponent) {
      let wrapper = assertElement(firstElementChild(this.element));

      // injects wrapper elements
      this.assert.equal(wrapper.getAttribute('class'), 'ember-view');
      this.assert.equal(toTextContent(wrapper), 'Hello World');
      // this.assert.equal(this.element.textContent, 'Hello World');
    } else {
      this.assertServerComponent(`${b(2)}Hello <!--%|%-->World${b(2)}`);
    }

    this.renderClientSide({
      layout,
      template,
    });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assert.equal(toTextContent(this.element), 'Hello World');
    this.assertStableRerender();
  }

  @test
  'Mismatched Multiple invocations'() {
    let name;
    let template;

    let emberishComponent = false;
    if (this.testType === 'Dynamic' || this.testType === 'Curly') {
      name = 'foo-bar';
      template = '{{#foo-bar}}World{{/foo-bar}}';
      emberishComponent = true;
    } else {
      name = 'FooBar';
      template = '<FooBar>World</FooBar>';
    }

    this.registerComponent(this.testType, name, 'Hello {{yield}}');
    let layout = `{{yield}}`;
    this.renderServerSide({
      layout,
      template,
    });
    let b = blockStack();
    if (emberishComponent) {
      let wrapper = assertElement(firstElementChild(this.element));
      // injects wrapper elements
      this.assert.equal(wrapper.getAttribute('class'), 'ember-view');
      this.assert.equal(toTextContent(this.element), 'Hello World');
    } else {
      this.assertServerComponent(`${b(2)}Hello <!--%|%-->World${b(2)}`);
    }

    if (this.testType === 'Dynamic' || this.testType === 'Curly') {
      template = '{{#foo-bar}}Chad{{/foo-bar}}';
    } else {
      template = '<FooBar>Chad</FooBar>';
    }

    this.renderClientSide({
      layout,
      template,
    });
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assert.equal(toTextContent(this.element), 'Hello Chad');
    this.assertStableRerender();
  }

  @test
  'interacting with builtins'() {
    let layout = strip`
      <ul>
        {{#each @items key="id" as |item i|}}
          {{#if item.show}}
            <li>{{item.name}}</li>
          {{else}}
            {{yield i}}
          {{/if}}
        {{/each}}
      </ul>`;
    this.registerHelper(
      'even',
      (params: ReadonlyArray<unknown>) => (params[0] as number) % 2 === 0
    );
    let template = '{{#if (even i)}}<FooBar @count={{i}} />{{/if}}';
    this.registerComponent('Fragment', 'FooBar', '<li>{{@count}}</li>');
    let blockParams = ['i'];
    let args = { items: 'items' };

    this.renderServerSide(
      {
        layout,
        template,
        blockParams,
        args,
      },
      {
        items: [
          { show: true, name: 'Industry' },
          { show: false, name: 'Standard' },
          { show: false, name: 'Components' },
        ],
      }
    );

    let b = blockStack();

    let id = (num: number) => (this.testType === 'Dynamic' ? num + 1 : num);

    this.assertServerComponent(strip`
      <ul>
        ${b(id(2))}
        ${b(id(3))}
        ${b(id(4))}
        ${b(id(5))}
        <li>
          ${b(id(6))}
          Industry
          ${b(id(6))}
        </li>
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(4))}
        ${b(id(5))}
        ${b(id(6))}
        <!---->
        ${b(id(6))}
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(4))}
        ${b(id(5))}
        ${b(id(6))}
        ${b(id(7))}
        <li>
          ${b(id(8))}
          2
          ${b(id(8))}
        </li>
        ${b(id(7))}
        ${b(id(6))}
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(3))}
        ${b(id(2))}
      </ul>
    `);

    this.renderClientSide(
      {
        layout,
        template,
        blockParams,
        args,
      },
      {
        items: [
          { show: true, name: 'Industry' },
          { show: false, name: 'Standard' },
          { show: false, name: 'Components' },
        ],
      }
    );

    this.assertComponent('<ul><li>Industry</li><!----><li>2</li></ul>');
    this.assertRehydrationStats({ nodesRemoved: 0 });
    this.assertStableRerender();
  }

  @test
  'mismatched interacting with builtins'() {
    let layout = strip`
      <ul>
        {{#each @items key="id" as |item i|}}
          {{#if item.show}}
            <li>{{item.name}}</li>
          {{else}}
            {{yield i}}
          {{/if}}
        {{/each}}
      </ul>`;
    this.registerHelper(
      'even',
      (params: ReadonlyArray<unknown>) => (params[0] as number) % 2 === 0
    );
    let template = '{{#if (even i)}}<FooBar @count={{i}} />{{/if}}';
    this.registerComponent('Fragment', 'FooBar', '<li>{{@count}}</li>');
    let blockParams = ['i'];
    let args = { items: 'items' };

    this.renderServerSide(
      {
        layout,
        template,
        blockParams,
        args,
      },
      {
        items: [
          { show: true, name: 'Industry' },
          { show: false, name: 'Standard' },
          { show: false, name: 'Components' },
        ],
      }
    );

    let b = blockStack();

    let id = (num: number) => (this.testType === 'Dynamic' ? num + 1 : num);

    this.assertServerComponent(strip`
      <ul>
        ${b(id(2))}
        ${b(id(3))}
        ${b(id(4))}
        ${b(id(5))}
        <li>
          ${b(id(6))}
          Industry
          ${b(id(6))}
        </li>
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(4))}
        ${b(id(5))}
        ${b(id(6))}
        <!---->
        ${b(id(6))}
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(4))}
        ${b(id(5))}
        ${b(id(6))}
        ${b(id(7))}
        <li>
          ${b(id(8))}
          2
          ${b(id(8))}
        </li>
        ${b(id(7))}
        ${b(id(6))}
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(3))}
        ${b(id(2))}
      </ul>
    `);

    this.renderClientSide(
      {
        layout,
        template,
        blockParams,
        args,
      },
      {
        items: [
          { show: true, name: 'Industry' },
          { show: true, name: 'Standard' },
          { show: true, name: 'Components' },
        ],
      }
    );

    this.assertRehydrationStats({ nodesRemoved: 1 });
    this.assertComponent('<ul><li>Industry</li><li>Standard</li><li>Components</li></ul>');
  }

  @test
  'mismatched blocks interacting with builtins'() {
    let layout = strip`
      <ul>
        {{#each @items key="id" as |item i|}}
          {{#if item.show}}
            <li>{{item.name}}</li>
          {{else}}
            {{yield i}}
          {{/if}}
        {{/each}}
      </ul>
      <ul>
        {{#each @things key="id" as |item i|}}
          {{#if item.show}}
            <li>{{item.name}}</li>
          {{else}}
            {{yield i}}
          {{/if}}
        {{/each}}
      </ul>
    `;
    this.registerHelper(
      'even',
      (params: ReadonlyArray<unknown>) => (params[0] as number) % 2 === 0
    );
    let template = '{{#if (even i)}}<FooBar @count={{i}} />{{/if}}';
    this.registerComponent('Fragment', 'FooBar', '<li>{{@count}}</li>');
    let blockParams = ['i'];
    let args = { items: 'items', things: 'things' };

    this.renderServerSide(
      {
        layout,
        template,
        blockParams,
        args,
      },
      {
        items: [
          { show: true, name: 'Industry' },
          { show: false, name: 'Standard' },
          { show: false, name: 'Components' },
        ],
      }
    );

    let b = blockStack();

    let id = (num: number) => (this.testType === 'Dynamic' ? num + 1 : num);

    this.assertServerComponent(strip`
      <ul>
        ${b(id(2))}
        ${b(id(3))}
        ${b(id(4))}
        ${b(id(5))}
        <li>
          ${b(id(6))}
          Industry
          ${b(id(6))}
        </li>
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(4))}
        ${b(id(5))}
        ${b(id(6))}
        <!---->
        ${b(id(6))}
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(4))}
        ${b(id(5))}
        ${b(id(6))}
        ${b(id(7))}
        <li>
          ${b(id(8))}
          2
          ${b(id(8))}
        </li>
        ${b(id(7))}
        ${b(id(6))}
        ${b(id(5))}
        ${b(id(4))}
        ${b(id(3))}
        ${b(id(2))}
      </ul>
      <ul>
        ${b(id(2))}
        <!---->
        ${b(id(2))}
      </ul>
    `);

    this.renderClientSide(
      {
        layout,
        template,
        blockParams,
        args,
      },
      {
        things: [
          { show: true, name: 'Industry' },
          { show: true, name: 'Standard' },
          { show: false, name: 'Components' },
        ],
      }
    );

    this.assertRehydrationStats({ nodesRemoved: 2 });
    this.assertComponent('<ul><!----></ul><ul><li>Industry</li><li>Standard</li><li>2</li></ul>');
  }
}

suite(Rehydration, RehydrationDelegate);
jitSuite(RenderTests);
componentSuite(RehydratingComponents, RehydrationDelegate);
