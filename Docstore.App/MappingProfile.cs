using AutoMapper;
using Docstore.App.Data;
using Docstore.App.Models.Forms;

namespace Docstore.App
{
    public class MappingProfile : Profile
    {
        public MappingProfile()
        {
            CreateMap<DocumentCreateForm, Document>()
                .ForMember(x => x.Files, act => act.Ignore());
        }
    }
}
