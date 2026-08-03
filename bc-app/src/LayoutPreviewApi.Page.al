namespace RepLayoutPreview;

using System.Environment.Configuration;
using Microsoft.Foundation.Reporting;

page 74750 "BCLP Layout Preview API"
{
    PageType = API;
    Caption = 'Layout Preview Request';
    APIPublisher = 'RepLayoutPreview';
    APIGroup = 'layoutPreview';
    APIVersion = 'v1.0';
    EntityName = 'layoutPreviewRequest';
    EntitySetName = 'layoutPreviewRequests';
    SourceTable = "BCLP Layout Preview Request";
    DelayedInsert = true;
    ODataKeyFields = SystemId;
    Extensible = false;
    Editable = true;

    layout
    {
        area(Content)
        {
            repeater(Group)
            {
                field(id; Rec.SystemId)
                {
                    Caption = 'Id';
                    Editable = false;
                }
                field(reportId; Rec."Report ID")
                {
                    Caption = 'Report Id';
                }
                field(tableId; Rec."Table ID")
                {
                    Caption = 'Table Id';
                }
                field(layoutName; Rec."Layout Name")
                {
                    Caption = 'Layout Name';
                }
                field(applicationId; Rec."Application ID")
                {
                    Caption = 'Application Id';
                }
                field(layoutFormat; Rec."Layout Format")
                {
                    Caption = 'Layout Format';
                }
                field(filterView; Rec."Filter View")
                {
                    Caption = 'Filter View';
                }
                field(requestPageXml; Rec."Request Page Xml")
                {
                    Caption = 'Request Page Xml';
                }
                field(rendered; Rec.Rendered)
                {
                    Caption = 'Rendered';
                    Editable = false;
                }
                field(errorMessage; Rec."Error Message")
                {
                    Caption = 'Error Message';
                    Editable = false;
                }
            }
        }
    }

    /// <summary>
    /// Stores the layout to render, supplied as a base64 string. Omit this call to render with a layout already published in the environment.
    /// </summary>
    [ServiceEnabled]
    procedure setLayout(content: Text)
    begin
        Rec.SetLayoutFromBase64(content);
    end;

    /// <summary>
    /// Renders the report to PDF and stores the result on the request. Any layout supplied by setLayout is registered under a scratch name for the duration of the call only.
    /// </summary>
    [ServiceEnabled]
    procedure render(var ActionContext: WebServiceActionContext)
    begin
        RenderRequest();

        ActionContext.SetObjectType(ObjectType::Page);
        ActionContext.SetObjectId(Page::"BCLP Layout Preview API");
        ActionContext.AddEntityKey(Rec.FieldNo(SystemId), Rec.SystemId);
        ActionContext.SetResultCode(WebServiceActionResultCode::Updated);
    end;

    /// <summary>
    /// Returns the rendered PDF as a base64 string.
    /// </summary>
    [ServiceEnabled]
    procedure getPdf(): Text
    begin
        exit(Rec.GetPdfAsBase64());
    end;

    local procedure RenderRequest()
    var
        ReportLayoutSelection: Record "Report Layout Selection";
        EmptyGuid: Guid;
        UsesScratchLayout: Boolean;
    begin
        Rec.Rendered := false;
        Rec."Error Message" := '';

        UsesScratchLayout := Rec.HasSuppliedLayout();

        if UsesScratchLayout then begin
            RegisterScratchLayout();
            Commit();
            ReportLayoutSelection.SetTempLayoutSelectedName(ScratchLayoutName(), EmptyGuid);
        end else
            if Rec."Layout Name" <> '' then
                ReportLayoutSelection.SetTempLayoutSelectedName(Rec."Layout Name", Rec."Application ID")
            else
                ReportLayoutSelection.ClearTempLayoutSelected();

        RenderToBlob();
        Rec.Rendered := true;

        ReportLayoutSelection.ClearTempLayoutSelected();

        if UsesScratchLayout then begin
            RemoveScratchLayout();
            Commit();
        end;

        Rec.Modify(true);
    end;

    local procedure RenderToBlob()
    var
        RecRef: RecordRef;
        PdfOutStream: OutStream;
    begin
        RecRef.Open(Rec."Table ID");
        if Rec."Filter View" <> '' then
            RecRef.SetView(Rec."Filter View");

        Clear(Rec."Result Pdf");
        Rec."Result Pdf".CreateOutStream(PdfOutStream);
        Report.SaveAs(Rec."Report ID", Rec."Request Page Xml", ReportFormat::Pdf, PdfOutStream, RecRef);
    end;

    local procedure RegisterScratchLayout()
    var
        TenantReportLayout: Record "Tenant Report Layout";
        LayoutInStream: InStream;
        EmptyGuid: Guid;
    begin
        RemoveScratchLayout();

        Rec.CalcFields(Layout);
        if Rec."Layout Format" = Rec."Layout Format"::RDLC then
            Rec.Layout.CreateInStream(LayoutInStream, TextEncoding::UTF8)
        else
            Rec.Layout.CreateInStream(LayoutInStream);

        TenantReportLayout.Init();
        TenantReportLayout."Report ID" := Rec."Report ID";
        TenantReportLayout.Name := ScratchLayoutName();
        TenantReportLayout."App ID" := EmptyGuid;
        TenantReportLayout."Company Name" := '';
        TenantReportLayout.Description := ScratchLayoutDescription();

        case Rec."Layout Format" of
            Rec."Layout Format"::RDLC:
                begin
                    TenantReportLayout."Layout Format" := TenantReportLayout."Layout Format"::RDLC;
                    TenantReportLayout."MIME Type" := 'text/xml';
                end;
            Rec."Layout Format"::Word:
                begin
                    TenantReportLayout."Layout Format" := TenantReportLayout."Layout Format"::Word;
                    TenantReportLayout."MIME Type" := 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
                end;
            Rec."Layout Format"::Excel:
                begin
                    TenantReportLayout."Layout Format" := TenantReportLayout."Layout Format"::Excel;
                    TenantReportLayout."MIME Type" := 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                end;
        end;

        TenantReportLayout.Layout.ImportStream(LayoutInStream, TenantReportLayout.Description);
        TenantReportLayout.Insert(true);
    end;

    local procedure RemoveScratchLayout()
    var
        TenantReportLayout: Record "Tenant Report Layout";
        EmptyGuid: Guid;
    begin
        if TenantReportLayout.Get(Rec."Report ID", ScratchLayoutName(), EmptyGuid) then
            TenantReportLayout.Delete(true);
    end;

    local procedure ScratchLayoutName(): Text[250]
    begin
        exit('ZZ_VSCODE_PREVIEW_SCRATCH');
    end;

    local procedure ScratchLayoutDescription(): Text[250]
    begin
        exit('Temporary layout written by the VS Code layout preview. Safe to delete.');
    end;
}
