namespace RepLayoutPreview;

using System.Text;

table 74750 "BCLP Layout Preview Request"
{
    Caption = 'Layout Preview Request';
    DataClassification = SystemMetadata;
    ReplicateData = false;

    fields
    {
        field(1; "Entry No."; Integer)
        {
            Caption = 'Entry No.';
            AutoIncrement = true;
        }
        field(10; "Report ID"; Integer)
        {
            Caption = 'Report ID';
        }
        field(11; "Table ID"; Integer)
        {
            Caption = 'Table ID';
        }
        field(12; "Layout Name"; Text[250])
        {
            Caption = 'Layout Name';
        }
        field(13; "Application ID"; Guid)
        {
            Caption = 'Application ID';
        }
        field(14; "Layout Format"; Enum "BCLP Layout Format")
        {
            Caption = 'Layout Format';
        }
        field(15; "Filter View"; Text[2048])
        {
            Caption = 'Filter View';
        }
        field(16; "Request Page Xml"; Text[2048])
        {
            Caption = 'Request Page Xml';
        }
        field(20; Layout; Blob)
        {
            Caption = 'Layout';
        }
        field(21; "Result Pdf"; Blob)
        {
            Caption = 'Result Pdf';
        }
        field(30; Rendered; Boolean)
        {
            Caption = 'Rendered';
        }
        field(31; "Error Message"; Text[2048])
        {
            Caption = 'Error Message';
        }
    }

    keys
    {
        key(PK; "Entry No.")
        {
            Clustered = true;
        }
    }

    /// <summary>
    /// Stores the supplied layout, given as base64, so that it can be registered as a scratch layout before rendering.
    /// </summary>
    procedure SetLayoutFromBase64(_Content: Text)
    var
        Base64Convert: Codeunit "Base64 Convert";
        LayoutOutStream: OutStream;
    begin
        Clear(Rec.Layout);
        if _Content = '' then
            exit;

        if Rec."Layout Format" = Rec."Layout Format"::RDLC then
            Rec.Layout.CreateOutStream(LayoutOutStream, TextEncoding::UTF8)
        else
            Rec.Layout.CreateOutStream(LayoutOutStream);

        Base64Convert.FromBase64(_Content, LayoutOutStream);
        Rec.Modify(true);
    end;

    /// <summary>
    /// Returns the rendered document as base64, or an empty string when the request has not been rendered yet.
    /// </summary>
    procedure GetPdfAsBase64(): Text
    var
        Base64Convert: Codeunit "Base64 Convert";
        PdfInStream: InStream;
    begin
        Rec.CalcFields("Result Pdf");
        if not Rec."Result Pdf".HasValue() then
            exit('');

        Rec."Result Pdf".CreateInStream(PdfInStream);
        exit(Base64Convert.ToBase64(PdfInStream));
    end;

    procedure HasSuppliedLayout(): Boolean
    begin
        Rec.CalcFields(Layout);
        exit(Rec.Layout.HasValue());
    end;
}
