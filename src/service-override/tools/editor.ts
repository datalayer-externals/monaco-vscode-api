import { StandaloneServices } from 'vs/editor/standalone/browser/standaloneServices'
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService'
import { IEditorService, isPreferredGroup, PreferredGroup, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService'
import { EditorCloseContext, GroupModelChangeKind, IActiveEditorChangeEvent, IEditorCloseEvent, IEditorControl, IEditorPane, IEditorWillOpenEvent, IResourceDiffEditorInput, isEditorInput, isResourceEditorInput, ITextDiffEditorPane, IUntitledTextResourceEditorInput, IUntypedEditorInput, IVisibleEditorPane } from 'vs/workbench/common/editor'
import { EditorInput } from 'vs/workbench/common/editor/editorInput'
import { IEditorOptions, IResourceEditorInput, ITextResourceEditorInput } from 'vs/platform/editor/common/editor'
import { applyTextEditorOptions } from 'vs/workbench/common/editor/editorOptions'
import { ScrollType } from 'vs/editor/common/editorCommon'
import { ICodeEditor, IDiffEditor } from 'vs/editor/browser/editorBrowser'
import { IEditorGroupView, DEFAULT_EDITOR_MAX_DIMENSIONS, DEFAULT_EDITOR_MIN_DIMENSIONS } from 'vs/workbench/browser/parts/editor/editor'
import { IResolvedTextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService'
import { IStandaloneCodeEditor, StandaloneCodeEditor, StandaloneEditor } from 'vs/editor/standalone/browser/standaloneCodeEditor'
import { Disposable, IReference } from 'vs/base/common/lifecycle'
import { EditorService } from 'vs/workbench/services/editor/browser/editorService'
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService'
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation'
import { IConfigurationService } from 'vs/platform/configuration/common/configuration'
import { IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust'
import { IEditorResolverService } from 'vs/workbench/services/editor/common/editorResolverService'
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity'
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace'
import { IFileService } from 'vs/platform/files/common/files'
import { ITextEditorService } from 'vs/workbench/services/textfile/common/textEditorService'
import { IHostService } from 'vs/workbench/services/host/browser/host'
import { Emitter, Event } from 'vs/base/common/event'
import { TextResourceEditorInput } from 'vs/workbench/common/editor/textResourceEditorInput'
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey'
import { URI } from 'vs/base/common/uri'
import { IGroupModelChangeEvent } from 'vs/workbench/common/editor/editorGroupModel'
import { EditorLayoutInfo } from 'vs/editor/common/config/editorOptions'
import { unsupported } from '../../tools'

export type OpenEditor = (modelRef: IReference<IResolvedTextEditorModel>, options: IEditorOptions | undefined, sideBySide?: boolean) => Promise<ICodeEditor | undefined>

class SimpleEditorPane implements IEditorPane {
  constructor (private editor?: ICodeEditor) {}

  onDidChangeControl = Event.None
  onDidChangeSizeConstraints = Event.None
  onDidFocus = Event.None
  onDidBlur = Event.None
  input = undefined
  options = undefined
  group = undefined
  scopedContextKeyService = undefined
  get minimumWidth () { return DEFAULT_EDITOR_MIN_DIMENSIONS.width }
  get maximumWidth () { return DEFAULT_EDITOR_MAX_DIMENSIONS.width }
  get minimumHeight () { return DEFAULT_EDITOR_MIN_DIMENSIONS.height }
  get maximumHeight () { return DEFAULT_EDITOR_MAX_DIMENSIONS.height }
  getViewState = unsupported
  isVisible = unsupported
  hasFocus = unsupported
  getId = unsupported
  getTitle = unsupported
  focus = unsupported

  getControl (): IEditorControl | undefined {
    return this.editor
  }
}

export function wrapOpenEditor (textModelService: ITextModelService, defaultBehavior: IEditorService['openEditor'], fallbackBahavior?: OpenEditor): IEditorService['openEditor'] {
  function openEditor(editor: EditorInput, options?: IEditorOptions, group?: PreferredGroup): Promise<IEditorPane | undefined>
  function openEditor(editor: IUntypedEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>
  function openEditor(editor: IResourceEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>
  function openEditor(editor: ITextResourceEditorInput | IUntitledTextResourceEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>
  function openEditor(editor: IResourceDiffEditorInput, group?: PreferredGroup): Promise<ITextDiffEditorPane | undefined>
  function openEditor(editor: EditorInput | IUntypedEditorInput, optionsOrPreferredGroup?: IEditorOptions | PreferredGroup, preferredGroup?: PreferredGroup): Promise<IEditorPane | undefined>
  async function openEditor (editor: EditorInput | IUntypedEditorInput, optionsOrPreferredGroup?: IEditorOptions | PreferredGroup, preferredGroup?: PreferredGroup): Promise<IEditorPane | undefined> {
    const options = isEditorInput(editor) ? optionsOrPreferredGroup as IEditorOptions : editor.options

    if (isPreferredGroup(optionsOrPreferredGroup)) {
      preferredGroup = optionsOrPreferredGroup
    }

    const resource = isResourceEditorInput(editor) || isEditorInput(editor) ? editor.resource : undefined

    if (resource == null || !textModelService.canHandleResource(resource)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return defaultBehavior(editor as any, optionsOrPreferredGroup as any, preferredGroup)
    }

    let modelEditor: ICodeEditor | undefined

    // If the model is already existing, try to find an associated editor
    const codeEditors = StandaloneServices.get(ICodeEditorService).listCodeEditors()
    modelEditor = codeEditors.find(editor => editor instanceof StandaloneEditor && editor.getModel() != null && editor.getModel()!.uri.toString() === resource.toString())

    if (modelEditor == null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const defaultBehaviorResult = await defaultBehavior(editor as any, optionsOrPreferredGroup as any, preferredGroup)
      if (defaultBehaviorResult != null) {
        return defaultBehaviorResult
      }

      const modelRef = await textModelService.createModelReference(resource)
      modelEditor = await fallbackBahavior?.(modelRef, options, preferredGroup === SIDE_GROUP)
      if (modelEditor == null) {
        // Dispose the newly created model if `openEditor` wasn't able to open it
        modelRef.dispose()
        return undefined
      }
    }

    // Otherwise, let the user destroy the model, never destroy the reference

    if (options != null) {
      // Apply selection
      applyTextEditorOptions(options, modelEditor, ScrollType.Immediate)
    }

    if (!(options?.preserveFocus ?? false)) {
      modelEditor.focus()
      modelEditor.getContainerDomNode().scrollIntoView()
    }

    // Return a very simple editor pane, only the `getControl` method is used
    return new SimpleEditorPane(modelEditor)
  }

  return openEditor
}

export class MonacoEditorService extends EditorService {
  constructor (
    _openEditorFallback: OpenEditor | undefined,
    private _isEditorPartVisible: () => boolean,
    @IEditorGroupsService _editorGroupService: IEditorGroupsService,
    @IInstantiationService instantiationService: IInstantiationService,
    @IFileService fileService: IFileService,
    @IConfigurationService configurationService: IConfigurationService,
    @IWorkspaceContextService contextService: IWorkspaceContextService,
    @IUriIdentityService uriIdentityService: IUriIdentityService,
    @IEditorResolverService editorResolverService: IEditorResolverService,
    @IWorkspaceTrustRequestService workspaceTrustRequestService: IWorkspaceTrustRequestService,
    @IHostService hostService: IHostService,
    @ITextEditorService textEditorService: ITextEditorService,
    @ITextModelService textModelService: ITextModelService
  ) {
    super(
      _editorGroupService,
      instantiationService,
      fileService,
      configurationService,
      contextService,
      uriIdentityService,
      editorResolverService,
      workspaceTrustRequestService,
      hostService,
      textEditorService
    )

    this.openEditor = wrapOpenEditor(textModelService, this.openEditor.bind(this), _openEditorFallback)
  }

  override get activeTextEditorControl (): ICodeEditor | IDiffEditor | undefined {
    // By default, only the editor inside the EditorPart can be "active" here, hack it so the active editor is now the focused editor if it exists
    // It is required for the editor.addAction to be able to add an entry in the editor action menu
    const focusedCodeEditor = StandaloneServices.get(ICodeEditorService).getFocusedCodeEditor()
    if (focusedCodeEditor != null && focusedCodeEditor instanceof StandaloneCodeEditor) {
      return focusedCodeEditor
    }

    return super.activeTextEditorControl
  }

  // Override openEditor to fallback on user function is the EditorPart is not visible
  override openEditor(editor: EditorInput, options?: IEditorOptions, group?: PreferredGroup): Promise<IEditorPane | undefined>
  override openEditor(editor: IUntypedEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>
  override openEditor(editor: IResourceEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>
  override openEditor(editor: ITextResourceEditorInput | IUntitledTextResourceEditorInput, group?: PreferredGroup): Promise<IEditorPane | undefined>
  override openEditor(editor: IResourceDiffEditorInput, group?: PreferredGroup): Promise<ITextDiffEditorPane | undefined>
  override openEditor(editor: EditorInput | IUntypedEditorInput, optionsOrPreferredGroup?: IEditorOptions | PreferredGroup, preferredGroup?: PreferredGroup): Promise<IEditorPane | undefined>
  override async openEditor (editor: EditorInput | IUntypedEditorInput, optionsOrPreferredGroup?: IEditorOptions | PreferredGroup, preferredGroup?: PreferredGroup): Promise<IEditorPane | undefined> {
    // Do not try to open the file if the editor part is not displayed, let the fallback happen
    if (!this._isEditorPartVisible()) {
      return undefined
    }

    return super.openEditor(editor, optionsOrPreferredGroup, preferredGroup)
  }
}

class StandaloneEditorPane implements IVisibleEditorPane {
  constructor (private editor: IStandaloneCodeEditor, public input: TextResourceEditorInput, public group: IEditorGroup) {
  }

  onDidChangeControl = Event.None

  options = undefined
  minimumWidth = 0
  maximumWidth = Number.POSITIVE_INFINITY
  minimumHeight = 0
  maximumHeight = Number.POSITIVE_INFINITY
  onDidChangeSizeConstraints = Event.None
  scopedContextKeyService = undefined
  getControl (): IEditorControl | undefined {
    return this.editor
  }

  getViewState (): object | undefined {
    return undefined
  }

  isVisible (): boolean {
    return true
  }

  onDidFocus = this.editor.onDidFocusEditorWidget
  onDidBlur = this.editor.onDidBlurEditorWidget
  hasFocus (): boolean {
    return this.editor.hasWidgetFocus()
  }

  getId (): string {
    return this.editor.getId()
  }

  getTitle (): string | undefined {
    return undefined
  }

  focus (): void {
    this.editor.focus()
  }
}

class StandaloneEditorGroup extends Disposable implements IEditorGroup, IEditorGroupView {
  private static idCounter = 0

  private pane: StandaloneEditorPane | undefined
  public active: boolean = false
  constructor (
    public editor: IStandaloneCodeEditor,
    @IInstantiationService instantiationService: IInstantiationService,
    @IContextKeyService public scopedContextKeyService: IContextKeyService
  ) {
    super()
    const onNewModel = (uri: URI) => {
      const editorInput = instantiationService.createInstance(TextResourceEditorInput, uri, undefined, undefined, undefined, undefined)

      this._onWillOpenEditor.fire({
        editor: editorInput,
        groupId: this.id
      })

      this.pane = new StandaloneEditorPane(editor, editorInput, this)

      this._onDidModelChange.fire({
        kind: GroupModelChangeKind.EDITOR_OPEN,
        editor: editorInput,
        editorIndex: 0
      })

      this._onDidActiveEditorChange.fire({
        editor: editorInput
      })
    }
    const onRemovedModel = (uri: URI) => {
      if (this.pane != null && this.pane.input.resource.toString() === uri.toString()) {
        const pane = this.pane
        this.pane = undefined
        this._onDidModelChange.fire({
          kind: GroupModelChangeKind.EDITOR_CLOSE,
          editorIndex: 0
        })

        this._onDidActiveEditorChange.fire({
          editor: undefined
        })

        this._onDidCloseEditor.fire({
          context: EditorCloseContext.UNKNOWN,
          editor: pane.input,
          groupId: this.id,
          index: 0,
          sticky: false
        })
      }
    }

    editor.onDidChangeModel((e) => {
      if (e.oldModelUrl != null) {
        onRemovedModel(e.oldModelUrl)
      }
      if (e.newModelUrl != null) {
        onNewModel(e.newModelUrl)
      }
    })
    this._register({
      dispose: () => {
        const model = editor.getModel()
        if (model != null) {
          onRemovedModel(model.uri)
        }
      }
    })
    const currentModel = editor.getModel()
    if (currentModel != null) {
      const editorInput = instantiationService.createInstance(TextResourceEditorInput, currentModel.uri, undefined, undefined, undefined, undefined)
      this.pane = new StandaloneEditorPane(editor, editorInput, this)
    }
  }

  onDidFocus = this.editor.onDidFocusEditorWidget
  onDidOpenEditorFail = Event.None
  whenRestored = Promise.resolve()
  get titleHeight () { return unsupported() }
  disposed = false
  setActive (isActive: boolean) {
    this.active = isActive
  }

  notifyIndexChanged = unsupported
  relayout = unsupported
  toJSON = unsupported
  get element () { return unsupported() }
  minimumWidth = 0
  maximumWidth = Number.POSITIVE_INFINITY
  minimumHeight = 0
  maximumHeight = Number.POSITIVE_INFINITY
  onDidChange: Event<EditorLayoutInfo> = this.editor.onDidLayoutChange
  layout = () => this.editor.layout()

  _onDidModelChange = new Emitter<IGroupModelChangeEvent>()
  onDidModelChange = this._onDidModelChange.event

  onWillDispose = this.editor.onDidDispose
  _onDidActiveEditorChange = new Emitter<IActiveEditorChangeEvent>()
  onDidActiveEditorChange = this._onDidActiveEditorChange.event

  onWillCloseEditor = Event.None

  _onDidCloseEditor = new Emitter<IEditorCloseEvent>()
  onDidCloseEditor = this._onDidCloseEditor.event

  onWillMoveEditor = Event.None

  _onWillOpenEditor = new Emitter<IEditorWillOpenEvent>()
  onWillOpenEditor = this._onWillOpenEditor.event

  readonly id = --StandaloneEditorGroup.idCounter
  index = -1
  label = `standalone editor ${this.editor.getId()}`
  ariaLabel = `standalone editor ${this.editor.getId()}`
  get activeEditorPane () {
    return this.pane
  }

  get activeEditor () {
    return this.pane?.input ?? null
  }

  previewEditor = null
  get count () {
    return this.pane != null ? 1 : 0
  }

  get isEmpty () {
    return this.pane == null
  }

  isLocked = true
  stickyCount = 0
  get editors () {
    return this.pane != null ? [this.pane.input] : []
  }

  getEditors = () => this.editors
  findEditors = (resource: URI) => this.pane != null && resource.toString() === this.pane.input.resource.toString() ? [this.pane.input] : []
  getEditorByIndex = (index: number) => this.pane != null && index === 0 ? this.pane.input : undefined
  getIndexOfEditor = (editorInput: EditorInput) => this.pane != null && this.pane.input === editorInput ? 0 : -1
  openEditor = unsupported
  openEditors = unsupported
  isPinned = () => false
  isSticky = () => false
  isActive = () => this.editor.hasWidgetFocus()
  contains = (candidate: EditorInput | IUntypedEditorInput) => {
    return this.pane != null && this.pane.input === candidate
  }

  moveEditor = unsupported
  moveEditors = unsupported
  copyEditor = unsupported
  copyEditors = unsupported
  closeEditor = unsupported
  closeEditors = unsupported
  closeAllEditors = unsupported
  replaceEditors = unsupported
  pinEditor = unsupported
  stickEditor = unsupported
  unstickEditor = unsupported
  lock = unsupported
  focus (): void {
    this.editor.focus()
  }

  isFirst = unsupported
  isLast = unsupported
}

export class MonacoDelegateEditorGroupsService<D extends IEditorGroupsService> extends Disposable implements IEditorGroupsService {
  readonly _serviceBrand = undefined

  public additionalGroups: StandaloneEditorGroup[] = []
  public activeGroupOverride: StandaloneEditorGroup | undefined = undefined

  constructor (protected delegate: D, @IInstantiationService instantiationService: IInstantiationService) {
    super()
    setTimeout(() => {
      const codeEditorService = StandaloneServices.get(ICodeEditorService)

      const handleCodeEditor = (editor: ICodeEditor) => {
        if (editor instanceof StandaloneEditor) {
          const onEditorFocused = () => {
            this.activeGroupOverride = this.additionalGroups.find(group => group.editor === editor)
            this._onDidChangeActiveGroup.fire(this.activeGroup)
          }
          editor.onDidFocusEditorText(onEditorFocused)
          editor.onDidFocusEditorWidget(onEditorFocused)
          if (editor.hasWidgetFocus()) {
            onEditorFocused()
          }

          const newGroup = instantiationService.createInstance(StandaloneEditorGroup, editor)
          this.additionalGroups.push(newGroup)
          this._onDidAddGroup.fire(newGroup)
        }
      }
      const handleCodeEditorRemoved = (editor: ICodeEditor) => {
        if (editor instanceof StandaloneEditor) {
          const removedGroup = this.additionalGroups.find(group => group.editor === editor)
          if (removedGroup != null) {
            removedGroup.dispose()
            if (this.activeGroupOverride === removedGroup) {
              this.activeGroupOverride = undefined
              this._onDidChangeActiveGroup.fire(this.activeGroup)
            }
            this.additionalGroups = this.additionalGroups.filter(group => group !== removedGroup)
            this._onDidRemoveGroup.fire(removedGroup)
          }
        }
      }
      this._register(codeEditorService.onCodeEditorAdd(handleCodeEditor))
      this._register(codeEditorService.onCodeEditorRemove(handleCodeEditorRemoved))
      codeEditorService.listCodeEditors().forEach(handleCodeEditor)
    })
  }

  public get groups (): IEditorGroup[] {
    return [...this.additionalGroups, ...this.delegate.groups]
  }

  public get activeGroup (): IEditorGroup {
    return this.activeGroupOverride ?? this.delegate.activeGroup
  }

  _onDidChangeActiveGroup = new Emitter<IEditorGroup>()
  onDidChangeActiveGroup = Event.any(this._onDidChangeActiveGroup.event, this.delegate.onDidChangeActiveGroup)

  _onDidAddGroup = new Emitter<IEditorGroup>()
  onDidAddGroup = Event.any(this._onDidAddGroup.event, this.delegate.onDidAddGroup)

  _onDidRemoveGroup = new Emitter<IEditorGroup>()
  onDidRemoveGroup = Event.any(this._onDidRemoveGroup.event, this.delegate.onDidRemoveGroup)

  onDidMoveGroup = this.delegate.onDidMoveGroup
  onDidActivateGroup = this.delegate.onDidActivateGroup
  onDidLayout = this.delegate.onDidLayout
  onDidScroll = this.delegate.onDidScroll
  onDidChangeGroupIndex = this.delegate.onDidChangeGroupIndex
  onDidChangeGroupLocked = this.delegate.onDidChangeGroupLocked
  get contentDimension (): IEditorGroupsService['contentDimension'] { return this.delegate.contentDimension }
  get sideGroup (): IEditorGroupsService['sideGroup'] { return this.delegate.sideGroup }
  get count (): IEditorGroupsService['count'] { return this.delegate.count + this.additionalGroups.length }
  get orientation (): IEditorGroupsService['orientation'] { return this.delegate.orientation }
  get isReady (): IEditorGroupsService['isReady'] { return this.delegate.isReady }
  get whenReady (): IEditorGroupsService['whenReady'] { return this.delegate.whenReady }
  get whenRestored (): IEditorGroupsService['whenRestored'] { return this.delegate.whenRestored }
  get hasRestorableState (): IEditorGroupsService['hasRestorableState'] { return this.delegate.hasRestorableState }
  get partOptions (): IEditorGroupsService['partOptions'] { return this.delegate.partOptions }

  getLayout: IEditorGroupsService['getLayout'] = () => {
    return this.delegate.getLayout()
  }

  getGroups: IEditorGroupsService['getGroups'] = (order) => {
    return [...this.additionalGroups, ...this.delegate.getGroups(order)]
  }

  getGroup: IEditorGroupsService['getGroup'] = (identifier) => {
    return this.delegate.getGroup(identifier) ?? this.additionalGroups.find(group => group.id === identifier)
  }

  activateGroup: IEditorGroupsService['activateGroup'] = (...args) => {
    return this.delegate.activateGroup(...args)
  }

  getSize: IEditorGroupsService['getSize'] = (...args) => {
    return this.delegate.getSize(...args)
  }

  setSize: IEditorGroupsService['setSize'] = (...args) => {
    return this.delegate.setSize(...args)
  }

  arrangeGroups: IEditorGroupsService['arrangeGroups'] = (...args) => {
    return this.delegate.arrangeGroups(...args)
  }

  applyLayout: IEditorGroupsService['applyLayout'] = (...args) => {
    return this.delegate.applyLayout(...args)
  }

  centerLayout: IEditorGroupsService['centerLayout'] = (...args) => {
    return this.delegate.centerLayout(...args)
  }

  isLayoutCentered: IEditorGroupsService['isLayoutCentered'] = (...args) => {
    return this.delegate.isLayoutCentered(...args)
  }

  setGroupOrientation: IEditorGroupsService['setGroupOrientation'] = (...args) => {
    return this.delegate.setGroupOrientation(...args)
  }

  findGroup: IEditorGroupsService['findGroup'] = (...args) => {
    return this.delegate.findGroup(...args)
  }

  addGroup: IEditorGroupsService['addGroup'] = (...args) => {
    return this.delegate.addGroup(...args)
  }

  removeGroup: IEditorGroupsService['removeGroup'] = (...args) => {
    return this.delegate.removeGroup(...args)
  }

  moveGroup: IEditorGroupsService['moveGroup'] = (...args) => {
    return this.delegate.moveGroup(...args)
  }

  mergeGroup: IEditorGroupsService['mergeGroup'] = (...args) => {
    return this.delegate.mergeGroup(...args)
  }

  mergeAllGroups: IEditorGroupsService['mergeAllGroups'] = (...args) => {
    return this.delegate.mergeAllGroups(...args)
  }

  copyGroup: IEditorGroupsService['copyGroup'] = (...args) => {
    return this.delegate.copyGroup(...args)
  }

  enforcePartOptions: IEditorGroupsService['enforcePartOptions'] = (...args) => {
    return this.delegate.enforcePartOptions(...args)
  }

  onDidChangeEditorPartOptions = this.delegate.onDidChangeEditorPartOptions
}
