module.exports.healthCheck = ()=>async(req,res)=>{
    try {
        return res.status(200).send({status:'server is running'});
    } catch (error) {
        console.log(error)
            res.status(500).send({message:'Internal server error'});
        
    }
}